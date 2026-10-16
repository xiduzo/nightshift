# Research: LangGraph for Night Shift

> **Superseded** (2026-10-16): after the spike (`langgraph-spike.md`) and the
> probes (`langgraph-probe.md`), the engine moved onto LangGraph. See
> `docs/steering/langgraph-engine.md`. The event log stays the read model;
> the checkpoint is the walk's own bookkeeping, not a second source of truth.
>
> Question: How can LangGraph (LangGraph.js) help Night Shift, first in the proof of concept (Slices 1–4) and later in a possible product? The answer can be "don't".
>
> Date: 2026-10-15. Versions checked: `@langchain/langgraph` 1.5.0 (2026-10-12), `@langchain/core` 1.2.17, Bun 1.3.10.
> Labels: **[V]** = verified against a primary source or by a local test. **[I]** = inference or opinion.

## TL;DR

- **Proof of concept: do not adopt LangGraph.** Build the engine as `docs/PLAN.md` describes. LangGraph's durability unit is the *node*. Night Shift's hard problem lives *inside* a node: a harness session that runs for hours, must survive a daemon restart, and must resume the *same* session after a usage-limit wait. LangGraph does not persist anything while a node runs. A node that dies mid-run restarts from the beginning **[V]**. You must still store the harness session id, the wait-until time, and the event log in your own libsql tables. LangGraph would then be a second state store next to the one that matters **[I]**.
- **Bun works, but persistence does not come for free.** The core library runs on Bun, including `interrupt()`, resume, and `AbortSignal` **[V, local test]**. The official SQLite checkpointer uses `better-sqlite3`, and Bun refuses to load it **[V]**. On libsql you must write your own `BaseCheckpointSaver` or trust a third-party package with one release **[V]**.
- **Borrow the design, not the dependency.** Several LangGraph ideas fit Night Shift well: a checkpoint per step, pending writes, an interrupt that resumes with a value, cooperative drain, idle timeouts with a heartbeat, and an error handler per node. Copy them into `packages/engine` (see [Recommendation](#recommendation)).
- **Future product: revisit only on a trigger**, for example server mode with remote runners, or nodes that become fine-grained LLM loops. Even then, compare LangGraph with DBOS, Temporal, and TanStack Workflow. LangGraph's paid Agent Server is not needed and does not fit a local desktop app **[I]**.

## How LangGraph works (the parts that matter here)

- **Super-steps and checkpoints [V].** LangGraph saves a checkpoint at each super-step boundary. When a node finishes, its writes go to `checkpoint_writes` as pending writes. These writes let a resume skip sibling nodes that already succeeded ([Checkpointers][ckpt]).
- **Durability modes [V].** `"exit"`, `"async"`, and `"sync"`. Only `"sync"` writes every checkpoint before the next step starts ([Checkpointers][ckpt]).
- **Interrupts re-run the node [V].** "the runtime restarts the entire node from the beginning" on resume. "Side effects called before `interrupt` must be idempotent." ([Interrupts][intr])
- **Fault tolerance (≥ 1.4.0) [V].** Per-node `retryPolicy` (default `maxAttempts` 3, exponential backoff). `timeout` with `runTimeout` and `idleTimeout`, where `runtime.heartbeat()` resets the idle clock. `errorHandler` routes with `Command({ goto })` after the retries run out. A timed-out attempt "clears any writes" ([Fault tolerance][ft]).
- **Graceful drain (≥ 1.4.0) [V].** `RunControl.requestDrain()` stops the run *between* super-steps: "Node mid-execution: runs to completion." It "does not cancel in-flight async work" ([Fault tolerance][ft]).
- **Recursion limit [V].** By default a run executes at most 25 super-steps per invocation. `recursionLimit` in the config raises it ([Graph API][gapi]).
- **No version pinning [V].** "LangGraph applies the latest graph immediately to *every* thread." A thread that waits at an interrupt breaks if you rename or remove its node ([Backward compatibility][bc]).

## Requirement → LangGraph feature → fit

| Night Shift requirement | LangGraph feature | Fit |
| --- | --- | --- |
| Build the graph from a user-drawn React Flow JSON file | `StateGraph` is an imperative builder (`addNode`, `addConditionalEdges`), so a loader can call it in a loop **[V]**. LangGraph has no first-party JSON graph format **[V]**. `langgraph-builder` is archived. `langgraph-gen-py` generates Python stubs from a spec **[V]**. | **Partial.** Easy to do, but the static types are lost and you still write the loader and validator **[I]**. |
| Edges on named outcomes (`pass`, `fail`, Decision label) | Conditional edges, or `Command({ goto })` from a node **[V]**. | **Good.** |
| Retry loops with a maximum count, and refusal of unbounded loops | Cycles are allowed. The only built-in limit is the graph-wide `recursionLimit` (default 25 super-steps) **[V]**. | **Gap.** A per-loop counter must live in state, and the validator is still yours. A full Epic needs a much higher `recursionLimit` **[I]**. |
| Fresh session with a tight brief on retry; rescue by a stronger model | `retryPolicy` re-runs the *same* node function. `errorHandler` and `nodeAttempt` can route to a rescue node **[V]**. | **Partial.** Night Shift retries are graph edges with new inputs, not blind re-runs. `retryPolicy` fits only transient errors **[I]**. |
| Gate: wait in the inbox for hours or days | `interrupt()` + checkpointer + `Command({ resume })`, possibly in a new process. Tested on Bun **[V]**. | **Strong.** This is LangGraph's best fit. Caveat: the node re-runs from the start on resume. |
| Usage-limit wait, then resume the **same** harness session | The OSS library has no durable timer or sleep primitive. Crons exist only in the paid Agent Server **[V]**. | **Gap.** You need your own persisted "wait until" fact and a scheduler that wakes up again after a daemon restart **[I]**. |
| Durable state across daemon restarts | A checkpoint per super-step plus pending writes **[V]**. Nothing is persisted *inside* a running node **[V]**. | **Gap in the critical case.** A crash 3 hours into a session restarts the node, and so starts a *new* session. The node only avoids that if it reads the session id from a store outside LangGraph **[I]**. |
| User stop and resume | `AbortSignal` reaches the node as `runtime.signal`, and abort raises `AbortError` **[V, local test]**. Drain waits for the node to finish **[V]**. | **Partial.** Stop works. Resume re-runs the node, and the "resume this harness session" logic is yours **[I]**. |
| Stop time, network grace, blocked propagation | Not provided **[V]**. | **Gap.** Engine code in both designs. |
| For Each: Traces in blocker order, list read again before each item, a failure blocks the items that depend on it | `Send` fans out *in parallel* within one super-step, with `maxConcurrency` **[V]**. | **Poor.** The sequential loop with a re-read and blocking is a hand-written conditional loop or a subgraph **[I]**. |
| Event log + derived status | Checkpoints are snapshots of state, plus `getStateHistory` **[V]**. | **Conflict.** Night Shift needs a domain event log (principle 4). LangGraph would become a second source of truth **[I]**. |
| Live transcript to the UI | `streamMode: "custom"` with `runtime.writer`. The `messages` mode covers only LangChain chat models **[V]**. | **Adds little.** The harness already yields an `AsyncIterable<AgentEvent>` that goes to SSE **[I]**. |
| Time budget per Agent node | `timeout: { runTimeout, idleTimeout }` with a `heartbeat()` on each harness event **[V]**. | **Good.** It is also simple to write yourself. |
| Time travel / fork | Replay from a `checkpoint_id`, and `updateState` with `asNode` **[V]**. | **Weak.** The worktree is not in the checkpoint. A replay re-runs hour-long sessions on changed files **[I]**. |
| libsql persistence on Bun | `SqliteSaver` needs `better-sqlite3`, and Bun throws "'better-sqlite3' is not yet supported in Bun" **[V, local test]**. `@beshkenadze/langgraph-checkpoint-libsql` 1.0.0 had one release (2025-11-07) and 48 downloads in the last month **[V]**. | **Gap.** Write a custom saver (`put`, `putWrites`, `getTuple`, `list`) **[V]**. |
| A flow edited while a run waits at a gate | The latest graph applies to all threads, and renaming or removing a node breaks threads that wait at an interrupt **[V]**. | **Risk.** Night Shift must pin a flow snapshot per run in either design **[I]**. |
| Visual tooling | Studio is a hosted web UI on smith.langchain.com. It needs a LangSmith account and an API key, and it talks to a local *in-memory* dev server. Safari blocks the localhost connection **[V]**. | **Not usable** inside Electrobun. The React Flow editor stays yours. |

**Score [I]:** LangGraph fits the gate and the node timeout well, and fits edges and node retries well enough. It leaves gaps in the three hard requirements: resuming the same session, waits that last hours, and a domain event log. Those three are the reason the engine exists.

## Risks and costs

- **Two sources of truth [I].** The Slice 1 contracts already store `agent_session.harness_session_id` and an append-only `event` table, and derive status (`interrupted` when the daemon died). LangGraph checkpoints would duplicate the run position, and the two stores can disagree after a crash. That brings back the bug class that the principle "durable facts, derived status" exists to remove.
- **The node is a black box to the runtime [I].** All of the value of a 3-hour Agent node is in its middle: the session id, the transcript, the reset time. LangGraph saves only what the node *returns*.
- **Custom checkpointer [V/I].** A Bun + libsql setup requires you to write and maintain a `BaseCheckpointSaver` against an internal serialization format that changes with LangGraph releases (250 versions published since January 2024) **[V: npm]**.
- **Dependency weight [V].** `@langchain/langgraph` has a peer dependency on `@langchain/core`, which depends on `langsmith`, `js-tiktoken`, `mustache`, and `p-queue`. Night Shift would use none of LangChain's model or tool abstractions, because TanStack AI owns them.
- **Release pace [V].** 1.0.0 shipped on 2025-10-18. 1.4.0 (2026-06-10) added the timeouts, error handlers, and drain. 1.5.0 shipped on 2026-10-12. The API is stable at 1.x but still grows fast. Issue #1472 (zod 4 type errors) has been open since 2025-07. Night Shift uses zod 4.5.
- **LangSmith pull [V].** The docs steer you to LangSmith tracing, Studio, and Deployment. Tracing is opt-in (`LANGSMITH_TRACING`). Keep it off under "local first" **[I]**.
- **Agent Server / Platform [V].** The library is MIT. The production Agent Server needs Postgres, Redis, and a `LANGGRAPH_CLOUD_LICENSE_KEY` checked against `beacon.langchain.com`. Cloud deployment needs the Plus plan ($39 per seat per month). Self-hosting with a control plane needs Enterprise. The `@langchain/langgraph-api` dev server is MIT but stores data in memory, "designed for development and testing". **None of these fits a desktop daemon [I].**

## Overlap with TanStack AI

- **No duplicated graph layer today [V].** TanStack AI provides model and harness adapters, tools, and *in-session* tool approval. It has no durable graph runner. TanStack Workflow's docs mention a `@tanstack/ai-orchestration` package, but that package is not on npm (404 on 2026-10-15).
- **Coexistence is technically clean [I].** A LangGraph node can call `AgentHarness.run()` and forward `runtime.signal`. The tested abort path supports this.
- **But half of LangGraph would go unused [I].** LangGraph's streaming of messages, its `ToolNode`, and its agent prebuilts all assume LangChain chat models. Night Shift would pay for `@langchain/core` and use only the Pregel loop and the checkpointer interface.
- **Watch TanStack Workflow [V].** `@tanstack/workflow-core` 0.0.4 (MIT, created 2026-05) offers durable steps, sleeps, signals, and approvals on an append-only event log with replay. `@tanstack/workflow-runtime` is labelled experimental. It ships no SQLite store, only in-memory, plus Postgres and D1 adapters that are also experimental. It sits in the same family as the stack you already have and has the event-log model you already chose. It is too young for Slice 1 **[I]**.

## Alternatives (durable graph or workflow execution in TypeScript)

| Option | Version (npm) | Extra server? | Local store | Bun | License | Fit note |
| --- | --- | --- | --- | --- | --- | --- |
| **Own engine (plan)** | — | No | libsql (have it) | Native | Apache-2.0 | Full control of session-level durability. Cost: the graph walk, waits, and resume, roughly the logic of `night-shift.py` **[I]**. |
| LangGraph.js | 1.5.0 | No (library) | Custom saver needed | Core yes, SqliteSaver no **[V]** | MIT | Durability per node. See the table above. |
| Mastra workflows | `@mastra/core` 1.77.0 | No | `@mastra/libsql` 1.26.1 **[V]** | Not verified | Apache-2.0 core, repo mixed **[V]** | Suspend and resume with snapshots that "persist across ... restarts", plus `.sleepUntil()` **[V]**. Defined in code, not JSON. Brings its own agent stack, which overlaps TanStack AI **[I]**. |
| Inngest | 4.24.0 | Yes (dev server or self-hosted) | Server-side | Not verified | SDK Apache-2.0, server SSPL + delayed Apache **[V]** | Strong at step durability and sleeps, but a second process in the desktop app **[I]**. |
| Temporal TS SDK | 1.24.0 | Yes (Temporal server) | Server-side | "experimental" (issue #2273, open) **[V]** | MIT | The gold standard for durability, and heavy for a personal tool **[I]**. |
| DBOS Transact TS | 5.2.11 | No (library) | **Postgres required** per its docs **[V]** | Not verified | MIT | Best model fit: a library with step checkpoints and recovery "from its last completed step" **[V]**. Blocked by libsql **[I]**. |
| Restate | SDK 1.17.3 | Yes (Restate server) | Server-side | Not verified | SDK MIT, server BSL 1.1 **[V]** | A second process with a BSL licence **[I]**. |
| Vercel Workflow SDK | `workflow` 5.2.2 | No locally (bundled backend) | Bundled local, Postgres, or a custom "World" **[V]** | Not verified | Apache-2.0 | Integrates per framework with a compile step. Fit with Electrobun is unknown **[I]**. |
| TanStack Workflow | core 0.0.4 | No | In-memory only today **[V]** | Not verified | MIT | Right shape (event log, approvals, signals). Pre-1.0 **[I]**. |

**Observation [I]:** No candidate stores the inside of a long-running external process. Every one checkpoints at step boundaries. Session resume is Night Shift's own problem whatever the choice. That shrinks the value of any framework to the graph walk and the waits.

## Recommendation

**Proof of concept (Slices 1–4): build our own engine and borrow these LangGraph designs [I].**

1. **Checkpoint after every node, before the next one starts.** This is LangGraph's `"sync"` mode. Append a `step.finished` event with the outcome and the outputs in the same transaction that selects the next node.
2. **Persist inside the node, as soon as you know a fact.** Write the harness `session` event, and the `resetAt` of a usage limit, to libsql as they arrive. LangGraph cannot do this, and it is the core of the run policy. The Slice 1 schema already does it for the session id.
3. **Gates resume with a value.** A Gate writes a `gate.opened` fact. The UI resolves it with a choice. The engine then continues the graph with that value. LangGraph's lesson applies: run the side effects of a node *after* its wait, or make them idempotent.
4. **Waits are facts, not timers.** A `wait.until` event with a timestamp. On daemon boot, rebuild the timers from open waits. This covers usage limits and the stop time.
5. **Idle timeout with a heartbeat.** Each `AgentEvent` resets the idle clock, and a separate wall-clock budget runs beside it. Copy the `runTimeout` / `idleTimeout` split.
6. **Drain versus abort.** "Stop after this node" (drain) and "stop now" (abort the session, mark it resumable) are two different commands. Model both.
7. **Error handler per node type.** After the retries run out, route to a declared outcome (`fail`, rescue). Never throw out of the graph walk.
8. **Pin the flow per run.** Store a copy (or hash plus content) of the flow JSON on the run at start. LangGraph's "latest graph applies to every thread" causes known failures. Night Shift's waits last for days, so the risk is larger.
9. **Keep the `Engine` interface as the seam.** If a later trigger fires, a LangGraph-backed or DBOS-backed engine can implement the same interface.

**Optional half-day spike, if you want evidence instead of argument.** Wrap `AgentHarness.run()` in a LangGraph node with a hand-written libsql saver. Kill the daemon 10 minutes into a session. Count the glue needed to resume the *same* session. Prediction **[I]**: almost all of the resume logic is outside LangGraph.

**Future product: revisit on a trigger, not on a date [I].**

- *Server mode or remote runners:* a run queue across machines becomes real. Compare the cost of a LangGraph Agent Server licence with DBOS (Postgres is fine on a server) and Temporal.
- *Nodes become fine-grained LLM loops* (for example a Decision node that grows into a multi-turn agent with tools): LangGraph earns its keep there. TanStack AI's own orchestration may land first.
- *TanStack Workflow reaches 1.0 with a SQLite or libsql store:* it is the closest match to the event-log model and the stack. Evaluate it first.
- *Users ask to import or export LangGraph graphs:* then add a JSON → `StateGraph` exporter. Do not change the runtime.

## Sources

All accessed 2026-10-15.

- LangGraph.js overview — https://docs.langchain.com/oss/javascript/langgraph/overview
- [ckpt] Checkpointers (super-steps, pending writes, durability modes, saver interface) — https://docs.langchain.com/oss/javascript/langgraph/checkpointers
- Persistence — https://docs.langchain.com/oss/javascript/langgraph/persistence
- [intr] Interrupts — https://docs.langchain.com/oss/javascript/langgraph/interrupts
- [ft] Fault tolerance (retries, timeouts, error handlers, graceful drain) — https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance
- [gapi] Graph API (`Send`, recursion limit, graph migrations) — https://docs.langchain.com/oss/javascript/langgraph/graph-api
- Use the Graph API (`maxConcurrency`) — https://docs.langchain.com/oss/javascript/langgraph/use-graph-api
- [bc] Backward compatibility — https://docs.langchain.com/oss/javascript/langgraph/backward-compatibility
- Streaming — https://docs.langchain.com/oss/javascript/langgraph/streaming
- Time travel — https://docs.langchain.com/oss/javascript/langgraph/use-time-travel
- Install (lists `bun add`) — https://docs.langchain.com/oss/javascript/langgraph/install
- Studio — https://docs.langchain.com/oss/javascript/langgraph/studio
- Local server — https://docs.langchain.com/oss/javascript/langgraph/local-server
- Deployment options — https://docs.langchain.com/langsmith/deployment
- Standalone Agent Server (licence key, beacon) — https://docs.langchain.com/langsmith/deploy-standalone-server
- LangSmith pricing — https://www.langchain.com/pricing
- langgraphjs source, `Runtime.signal` and `heartbeat` — https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/pregel/runnable_types.ts
- langgraphjs issue #1472 (zod 4) — https://github.com/langchain-ai/langgraphjs/issues/1472
- langgraph-builder (archived), langgraph-gen-py — https://github.com/langchain-ai/langgraph-builder, https://github.com/langchain-ai/langgraph-gen-py
- npm registry metadata for every package version cited — https://registry.npmjs.org/@langchain/langgraph (and siblings)
- Bun's refusal to load better-sqlite3 — https://github.com/oven-sh/bun/blob/main/src/jsc/bindings/BunProcess.cpp, https://github.com/oven-sh/bun/issues/4290
- Third-party libsql saver — https://www.npmjs.com/package/@beshkenadze/langgraph-checkpoint-libsql
- TanStack Workflow overview — https://tanstack.com/workflow/latest/docs/overview
- TanStack AI overview — https://tanstack.com/ai/latest/docs/getting-started/overview
- Mastra suspend and resume — https://mastra.ai/docs/workflows/suspend-and-resume
- DBOS TypeScript programming guide — https://docs.dbos.dev/typescript/programming-guide
- Temporal TS "Full Bun Support" issue #2273 — https://github.com/temporalio/sdk-typescript/issues/2273
- Inngest licence — https://github.com/inngest/inngest (README, LICENSE.md)
- Restate licence — https://github.com/restatedev/restate/blob/main/LICENSE
- Vercel Workflow SDK — https://github.com/vercel/workflow
- Local test (Bun 1.3.10, `@langchain/langgraph` 1.5.0): interrupt → resume across invocations OK; `runtime.signal` present and abort raises `AbortError`; `SqliteSaver` fails with "'better-sqlite3' is not yet supported in Bun". The script was in the session scratchpad, not in the repo.
