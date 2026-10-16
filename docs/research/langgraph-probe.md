# LangGraph.js 1.5.0 probes for the Night Shift run engine

> The engine these probes informed shipped on 2026-10-16: see
> `docs/steering/langgraph-engine.md` and `packages/engine/src/graph/`. The
> spike package `packages/engine-langgraph`, and the probe tests with it,
> no longer exist; the verdicts below are kept as recorded.

Every verdict below was backed by a passing Bun test in
`packages/engine-langgraph/src/probe/` (branch `spike/langgraph`), run with
`bun test src/probe/` from `packages/engine-langgraph`. 28 tests, all green,
MemorySaver only. The graphs mirror compile.ts: no static edges, every node
returns `new Command({ update, goto })`, subgraphs are invoked from inside a
node with the config passed through. Where the type definitions mattered, they
were read from `node_modules/.bun/@langchain+langgraph@1.5.0*/.../dist/*.d.ts`.

Verdict summary

| # | Question | Verdict |
|---|----------|---------|
| 1 | `invoke(new Command({ goto, update }))` continues an ended thread at that node with prior state | **Yes** |
| 1 | Re-entering a parent node continues its subgraph body at the failed node | **No by default** (body starts over, new namespace); **yes** with `body.compile({ checkpointer: true })` + a `Command({ goto })` into the body |
| 2 | Sequential `interrupt()` calls in one node take resume values in order | **Yes** (the node function re-runs from the top each time) |
| 3 | `durability` exists; `"sync"` writes the checkpoint before the next node | **Yes**; default is `"async"`, which lets nodes run ahead of the writes |
| 4 | Depth-2 interrupt resumes inside B with A's and the parent's state intact | **Yes** |
| 5 | After a mid-node throw, `invoke(null)` re-runs the node from the last checkpoint, no partial writes | **Yes**; `retryPolicy` works with Command-returning nodes |
| 6 | `config.store` persists mid-node, even if the node later throws | **Yes**; a custom store needs one abstract method, `batch` |
| 7 | `updateState(config, values, asNode)` can clear `ended` and point `next` at a node | **Yes, when `values` is a `Command` with `goto`**; plain values leave `next` empty |

---

## 1. Continue a thread that reached END, at a chosen node

File: `src/probe/q1-continue-ended.test.ts`

### Verdict: yes

`graph.invoke(new Command({ goto: "b", update: {...} }), { configurable: { thread_id } })`
on a thread whose last checkpoint has `next: []` starts at `b`. All channels
(`nodes`, `traversals`, `steps`, `ended`) carry over from the thread's latest
checkpoint; the `update` is applied before `b` runs; the new checkpoints are
appended to the same thread history.

```ts
const first = await graph.invoke({}, config);            // a → b → c, ended
expect((await graph.getState(config)).next).toEqual([]);

const second = await graph.invoke(
  new Command({ goto: "b", update: { ended: null, steps: ["re-entry"] } }),
  config,
);
// log: ["b", "c"]; nodes.a kept (visit 1), nodes.b/c now visit 2,
// traversals: { "a->b": 1, "b->c": 2, "c->__end__": 2 }
// steps: ["a","b","c","re-entry","b","c"]
```

`new Command({ goto: "c" })` without an update works too.

### The `updateState` alternative

- `updateState(config, { ended: null }, "a")` with **plain values** patches the
  channels but leaves `next: []`: a node's writers only produce a
  `branch:to:*` write when the value is a Command, and there are no static
  edges to follow. `invoke(null)` afterwards runs nothing.
- `updateState(config, new Command({ update: {...}, goto: "b" }), "a")` sets
  `next: ["b"]`; `invoke(null, config)` then runs `b → c`. Equivalent to the
  Command-input form, split in two steps (useful if you want to inspect `next`
  before running).

### 1b. The node lives inside a subgraph invoked from a parent node (For Each body)

**Default (`body.compile()` without a checkpointer): the body starts over.**
Re-entering the parent with `Command({ goto: "each" })` re-runs the parent
node function, which calls `body.invoke({...}, config)` with a fresh input.
The body's checkpoint namespace is `each:<task id>`; the task id is derived
from the parent's checkpoint id, so each entry of the parent node creates a
**new** namespace (`each:<uuid-1>`, `each:<uuid-2>`), and the body's earlier
history is not consulted. `getState({ checkpoint_ns: "each:<uuid>" })` and
`updateState` on that namespace throw `Subgraph "each" not found` unless the
subgraph is declared on the node (`addNode("each", fn, { subgraphs: [body] })`).

**What works: `body.compile({ checkpointer: true })`.** The d.ts/implementation
(`_ownCheckpointConfig`) says: "A `checkpointer: true` subgraph keeps one
history per thread, stored under its namespace with the task ids removed."
So the body's checkpoints land under plain `each`, the same namespace on every
entry, and the parent node can continue it with a Command:

```ts
const body = bodyGraph().compile({ checkpointer: true });   // stable ns "each"

const graph = new StateGraph(ProbeState)
  .addNode("each", async (state, config) => {
    const continueAt = state.nodes.each?.continueAt as string | undefined;
    const result = await body.invoke(
      continueAt
        ? new Command({ goto: continueAt, update: { ended: null } }) // re-entry: continue at y
        : {},                                                        // first entry: fresh input
      config,
    );
    ...
  }, { ends, subgraphs: [body] })   // subgraphs: [...] makes the ns addressable
  ...
  .compile({ checkpointer: saver });

// First run: x → y, y fails. Then:
await graph.invoke(
  new Command({ goto: "each", update: { ended: null, nodes: { each: { ...first.nodes.each, continueAt: "y" } } } }),
  config,
);
// log: ["parent:each", "body:y", "parent:after"]  — x did NOT run again
// body state (getState({ thread_id, checkpoint_ns: "each" })): nodes.x visit 1, nodes.y visit 2
```

Stored namespaces in the saver after this: `["", "each"]`. The parent task's
own `config.configurable.checkpoint_ns` is still `each:<task id>` (differs
per entry), but that no longer matters.

### 1c. One body history per For Each element

With one shared `each` namespace, every element would share one body history
(channel state carries over between elements: `steps` accumulate, `nodes`
of element A are visible to element B). To isolate elements, extend
`checkpoint_ns` yourself when invoking the body:

```ts
const cfg = {
  ...config,
  configurable: { ...config.configurable, checkpoint_ns: `${config.configurable?.checkpoint_ns}|item-${item.id}` },
};
const r = await body.invoke({ steps: [] }, cfg);
```

Stored namespaces: `"each|item-A"`, `"each|item-B|1"` (task ids stripped; the
second subgraph call inside one task gets a `|1` counter suffix, third `|2`,
and so on). Each is addressable: `graph.getState({ configurable: { thread_id, checkpoint_ns: "each|item-A" } })`.
On re-entry, each element continues its own history.

### Gotchas

- A thread with `next: []` plus a non-Command input (e.g. `invoke({}, config)`)
  starts from START again but **keeps all channel state** (the normal
  multi-turn pattern). With Night Shift's reducers, `steps` keeps growing and
  `nodes` is never cleared. Reset explicitly in the `update` if a clean
  re-run is wanted.
- `Command({ goto })` at the root is implemented as a `branch:to:<node>` write
  attributed to the null task id, i.e. exactly what a node's own `goto` writes.
  Only nodes listed in that node's `ends` (or any node, when routing from the
  input) can be targeted; the target must exist or compile fails.
- The `|1` suffix means the element namespace depends on invocation order
  within one parent task. Keep the per-element loop order stable, or make one
  element per parent super-step (as compile.ts already does with `goto: node.id`),
  so the suffix is always absent.
- `checkpointer: true` on a subgraph means "borrow the parent's checkpointer";
  it is an error for a root graph. The body gets the saver through
  `config.configurable.__pregel_checkpointer`.

---

## 2. Sequential `interrupt()` calls in one node

File: `src/probe/q2-sequential-interrupts.test.ts`

### Verdict: yes

Each `Command({ resume })` answers the next unanswered interrupt, in call
order. The node function re-runs from its top on every resume; earlier
`interrupt()` calls return their stored resume values without pausing, and
the first one with no stored value pauses again.

```ts
.addNode("ask", () => {
  let n = 0;
  let a = interrupt<string, string>(`q${n}`);
  while (a === "again") { n += 1; a = interrupt<string, string>(`q${n}`); }
  return new Command({ update: { nodes: { ask: { answer: a, asked: n + 1 } } }, goto: END });
}, { ends: [END] })

await graph.invoke({}, config);                             // pauses at q0; tasks[0].interrupts = [q0]
await graph.invoke(new Command({ resume: "again" }), config); // pauses at q1
await graph.invoke(new Command({ resume: "again" }), config); // pauses at q2
await graph.invoke(new Command({ resume: "ok" }), config);    // completes: { answer: "ok", asked: 3 }
```

Observed per run: run 2 saw `q0=again`; run 3 saw `q0=again, q1=again`; run 4
saw `q0=again, q1=again, q2=ok`. The node ran 4 times in total.

With `stream(..., { streamMode: "updates" })` the chunk is
`{ __interrupt__: [{ value: "q1", ... }] }` carrying only the current
question; the final chunk is `{ ask: { nodes: {...} } }`.

### Gotchas

- Anything before the interrupt in the node body runs again on each resume
  (side effects, harness calls). Keep the pre-interrupt part idempotent, or
  put the interrupt in its own node (compile.ts's `wait__<id>` pattern does
  this already).
- Resume values are matched by position, so the sequence of `interrupt()`
  calls must be deterministic across re-runs.

---

## 3. `durability`

File: `src/probe/q3-durability.test.ts`

### Verdict: yes, it exists; default `"async"`

`pregel/types.d.ts` (PregelOptions):

```ts
/**
 * Whether to checkpoint during the run (or only at the end/interruption).
 * - "async": Save checkpoint asynchronously while the next step executes (default).
 * - "sync": Save checkpoint synchronously before the next step starts.
 * - "exit": Save checkpoint only when the graph exits.
 * @default "async"
 */
durability?: Durability;
/** @deprecated Use `durability` instead. */
checkpointDuring?: boolean;
```

Measured with a saver whose `put` sleeps 15 ms and logs start/done:

- `"sync"`: `put:done(step n)` always precedes the node of step n+1:
  `put -1, put 0, node:a, put 1, node:b, put 2, node:c, put 3`.
- `"async"` and unset: the nodes do not wait at all. Log:
  `put:start(-1), node:a, node:b, node:c, put:done(-1), put 0, put 1, put 2, put 3`.
  With a slow saver the **entire run finished before the first checkpoint
  landed**; the puts are then awaited in order before `invoke` returns, so the
  history is complete at the end, but a crash mid-run could leave several
  steps unwritten.
- `"exit"`: only the final checkpoint (`step 3`) is written; history has one
  entry.
- Passing both `durability` and `checkpointDuring` throws
  `Cannot use both \`durability\` and \`checkpointDuring\` at the same time.`

```ts
await graph.invoke(input, { configurable: { thread_id }, durability: "sync" });
```

### Gotchas

- For a daemon whose promise is "resume from the last node after a crash",
  use `"sync"`. The cost is one awaited libsql write per super-step.
- Source (`pregel/index.js`): default resolves as
  `config.durability ?? checkpointDuring-mapping ?? configurable.__pregel_durability ?? "async"`;
  subgraphs inherit the parent's via `__pregel_durability`.

---

## 4. Interrupt at depth 2

File: `src/probe/q4-depth2-interrupt.test.ts`

### Verdict: yes

Setup: parent `p0 → p1 → p2`, `p1` invokes A (`a0 → a1 → a2`), `a1` invokes B
(`b0 → b1 → b2`), `b1` calls `interrupt()`. Subgraphs declared with
`{ subgraphs: [A] }` / `{ subgraphs: [B] }` on the invoking nodes.

First run log: `p0, p1:enter, a0, a1:enter, b0, b1:enter`.

Stream chunks (`streamMode: "updates", subgraphs: true`), as
`[namespace, data]` with task ids elided:

```
[[],            { p0: ... }]
[["p1"],        { a0: ... }]
[["p1", "a1"],  { b0: ... }]
[["p1", "a1"],  { __interrupt__: [{ value: { q: "b1 asks" } }] }]   // innermost first
[["p1"],        { __interrupt__: [...] }]
[[],            { __interrupt__: [...] }]
```

Namespace parts are `p1:<uuid>` and `a1:<uuid>` (node name, colon, task id).
The interrupt chunk is repeated once per level up to the root, so a consumer
should keep only `namespace.length === 0` (run.ts already does this).

`getState(config, { subgraphs: true })` nests the levels:
`root.next = ["p1"]`, `root.tasks[0].interrupts[0].value = { q: "b1 asks" }`,
`root.tasks[0].state.next = ["a1"]`, `...state.tasks[0].state.next = ["b1"]`,
with B's values `steps: ["b0"]`. Saver namespaces: `""`, `p1:<id>`,
`p1:<id>|a1:<id>`.

Resume from the root:

```ts
for await (const chunk of await graph.stream(new Command({ resume: "yes" }), {
  ...config, streamMode: "updates", subgraphs: true,
})) ...
```

Log: `p1:enter, a1:enter, b1:enter, b1:resumed=yes, b2, a1:done, a2, p1:done, p2`.
`p0`, `a0`, `b0` did **not** run again; the invoking node functions `p1`
and `a1` were re-entered (their task never completed) and their
`subgraph.invoke(...)` calls resumed the subgraphs from their checkpoints.
Resume chunks: `[["p1","a1"], b1]`, `[["p1","a1"], b2]`, `[["p1"], a1]`,
`[["p1"], a2]`, `[[], p1]`, `[[], p2]`. Final state: A saw B's full result
(`bSteps: ["b0","b1","b2"]`, `bAnswer: "yes"`), `a0.visit === 1`,
`p1.visit === 1`.

### Gotchas

- Everything in `p1` and `a1` **before** their `subgraph.invoke` runs again on
  resume (same caveat as Q2). compile.ts's `subflowStep`/`forEachStep` only
  emit an event and bind inputs there, which is fine.
- The subgraph must be invoked with the node's `config` passed through, or the
  interrupt cannot be routed back; the existing `callFlow` does this.

---

## 5. Crash mid-node

File: `src/probe/q5-crash.test.ts`

### Verdict: yes

Node `b` throws on its first attempt. `invoke` rejects with the error. Then:

```ts
const s = await graph.getState(config);
s.next                 // ["b"]
s.tasks[0].name        // "b"
s.tasks[0].error       // { name: "Error", message: "boom on first attempt" }  (plain object, not an Error)
s.values               // the checkpoint after a: nodes = { a: {...} }, steps = ["a"], ended = null
s.metadata.step        // 1
```

Nothing `b` would have written is visible: a node's `Command.update` is only
applied when the node returns, so a throw leaves no partial channel writes.
(The error itself is stored as a pending write on channel `__error__`, which
is how `tasks[].error` is populated.)

`await graph.invoke(null, config)` re-runs **only `b`** from the checkpoint
after `a` (log `b#2, c`), `b` sees `nodes.a`, and the run ends normally;
afterwards `next: []`, `tasks: []`. A fresh compiled graph over the same saver
(daemon restart) behaves the same.

### `retryPolicy`

```ts
.addNode("b", fn, { ends, retryPolicy: { maxAttempts: 3, initialInterval: 1, jitter: false, logWarning: false } })
```

The node is retried inside the same super-step; the Command it finally
returns is honoured (log `a, b#1, b#2, c`; history steps `3,2,1,0,-1`, no
extra checkpoint for the retry). When attempts are exhausted the last error
surfaces, `next` is still `["b"]`, and `invoke(null)` starts a fresh set of
attempts. `RetryPolicy` fields (d.ts): `initialInterval` (500), `backoffFactor`
(2), `maxInterval` (128000), `maxAttempts` (3), `jitter` (true), `retryOn(e)`,
`logWarning` (true). There is also `StateGraph.setNodeDefaults({ retryPolicy })`
and a per-node `errorHandler` that runs after retries are exhausted (not probed).

### Gotchas

- Default `jitter: true` adds hundreds of ms per retry; set `initialInterval`
  and `jitter` explicitly in tests.
- Retries re-run the whole node function (same as Q2/Q4): an Agent node that
  already streamed half a harness session would start a new session unless
  `pending`/session id is carried some other way (see Q6).

---

## 6. A side channel for mid-node facts: `config.store`

File: `src/probe/q6-store.test.ts`

### Verdict: yes

`compile({ checkpointer, store: new InMemoryStore() })` or per call
`invoke(input, { ...config, store })`. Inside a node, `config.store` (and
`getStore()`) is an `AsyncBatchedStore` wrapping the given store;
`await store.put(ns, key, value)` resolves once the write is applied and the
value is readable from outside the node immediately. It is not tied to the
checkpoint: when the node then throws, the put stays.

```ts
.addNode("work", async (_state, config) => {
  await config.store?.put(["runs", runId], "progress", { attempt, phase: "half-way" });
  throw new Error("crash after the put");   // the put survives
}, ...)
.compile({ checkpointer, store });

await expect(graph.invoke({}, config)).rejects.toThrow();
(await store.get(["runs", runId], "progress"))?.value   // { attempt: 1, phase: "half-way" }
```

### A custom (libsql) store

`BaseStore` (`@langchain/langgraph-checkpoint/dist/store/base.d.ts`) has **one
abstract method**:

```ts
abstract batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>>;
```

`get`, `search`, `put`, `delete`, `listNamespaces`, `start`, `stop` are
concrete and delegate to `batch`. `Operation` is a union of
`GetOperation { namespace, key }`, `PutOperation { namespace, key, value | null, index? }`
(null value = delete), `SearchOperation { namespacePrefix, filter?, limit?, offset?, query? }`
and `ListNamespacesOperation { matchConditions?, maxDepth?, limit, offset }`;
results are `Item | null`, `void`, `SearchItem[]`, `string[][]` respectively.
The probe's `MapStore` (about 40 lines) implements this and is accepted by
`compile({ store })`. A libsql table `(namespace TEXT, key TEXT, value JSON,
created_at, updated_at, PRIMARY KEY(namespace, key))` is a reasonable backing;
the vector `query` can be ignored.

### Gotchas

- The store is a key/value side table, not part of the checkpoint: time
  travel / forks do not roll it back, and it is not in `getState().values`.
- Writes are batched per tick by `AsyncBatchedStore`; always `await` the put.
- `config.store` is `undefined` if neither compile nor the call passes one.

---

## 7. `updateState` with Command-only routing

File: `src/probe/q7-update-state.test.ts`

### Verdict: yes, with a Command as the value

| Call | Channels | `next` |
|------|----------|--------|
| `updateState(config, { ended: null, steps: [...] }, "b")` | updated | `[]` (no static edge from b) |
| `updateState(config, new Command({ update: { ended: null }, goto: "c" }), "b")` | updated | `["c"]`, `tasks = [c]` |
| `updateState(config, values)` after a finished run | attributed to the last node (`c`) | `[]` |
| `updateState(freshConfig, values)` (no checkpoint yet) | attributed to `__start__` | `["a"]` — seeds a thread, `invoke(null)` then runs it |
| `updateState(config, null, "__end__")` | unchanged | `[]` |
| `updateState(config, values, "__input__")` | values pending as input | `["__start__"]`; `invoke(null)` walks the graph from START again |
| while `b` is pending after a crash: `updateState(config, new Command({ update, goto: END }), "b")` | updated | `[]`; `invoke(null)` does not run `b` |

So to clear `ended` and continue at `c`:

```ts
await graph.updateState(config, new Command({ update: { ended: null }, goto: "c" }), "b");
await graph.invoke(null, config);    // runs c
```

which is the two-step form of `graph.invoke(new Command({ goto: "c", update: { ended: null } }), config)`.

### Gotchas

- The update creates a checkpoint with `metadata.source: "update"`; in 1.5.0
  `metadata.writes` is not populated (only `source`, `step`, `parents`,
  `thread_id`).
- `asNode` must name a node of the graph; the Command's `goto` must be in that
  node's `ends` (same rule as at run time).
- An `updateState` as the pending node replaces the pending task's outcome
  (useful to "mark a crashed step as done by hand").

---

## What this means for the migration (short)

- Re-running a failed run from a node: `invoke(new Command({ goto: nodeId, update: { ended: null, pending: null } }), { configurable: { thread_id: runId }, durability: "sync" })`. No `updateState` needed.
- For Each / Subflow bodies: compile them with `checkpointer: true` and give each element its own `checkpoint_ns` suffix, so a failed element can be continued at its failed node instead of restarted; declare the compiled body in `addNode(..., { subgraphs: [body] })` so its state is readable by namespace.
- Use `durability: "sync"` on every run; the default lets nodes outrun their checkpoints.
- Facts that must outlive a crashed node (harness session id, partial cost) go to `config.store`, not the checkpoint; a libsql `BaseStore` is one `batch` method.
- `tasks[].error` is a `{ name, message }` object; `invoke(null)` is the resume after a crash and re-runs only the failed node.
