# The run engine on LangGraph

**Status:** implemented (2026-10-16). **Spike:** `docs/research/langgraph-spike.md`.
**Probes:** `docs/research/langgraph-probe.md`. **Thinning (2026-10-17):**
`docs/research/langgraph-thinning.md`.

Night Shift's run engine (`packages/engine`) runs its control flow and
durability on LangGraph (`@langchain/langgraph`). A run is one LangGraph
thread (thread id = run id). The flow the run snapshotted at start compiles
into a `StateGraph`; every flow node is one graph node; LangGraph checkpoints
the run state in Night Shift's own database after every node; the three ways
a run parks (a usage-limit or network wait, a Wait node's own wait, a Gate)
and the three ways a run ends early (failed, stopped, needs a person) are
LangGraph `interrupt`s, so a resume always lands back at the exact node, at
any depth.

What did **not** change: the `Engine` interface (`types.ts`), the API, the
web app, the event log as the read model, transcripts on disk, the bus,
the scheduler, worktrees, leases, run bundles, settings, profiles,
connections and the harnesses. The existing engine test
suites were the acceptance criteria.

## Layering

```
packages/engine/src/
  graph/state.ts           RunState (zod): inputs, stopAt, nodes, visits,
                           traversals, loops, pending (a wait with its
                           streak, a parked step, or an open Gate), ended.
                           Also the typed payloads that cross the graph's
                           boundary: Parked (an interrupt), ResumeValue,
                           RunEvent (custom stream chunks).
  graph/checkpointer.ts    LibsqlSaver: BaseCheckpointSaver on db.$client.
                           Tables lg_checkpoint and lg_write (drizzle schema in
                           packages/db, migration
                           20261016155422_langgraph_checkpoints). pruneThread
                           keeps a thread's latest root checkpoint.
  graph/compile.ts         compileFlow(flow, ctx): StateGraph. START →
                           flow.start; every flow node plus its park node
                           park__<id>; Agent nodes, Decisions decided by
                           a model and Values made by a model also get a
                           wait node wait__<id>; a
                           Decision decided by a person gets an ask node
                           ask__<id>. No static edges.
  graph/route.ts           route(): picks the edge with `nextEdge`, logs
                           EdgeTaken and returns `new Command({ update,
                           goto })`; or ends the flow (isChosenEnd,
                           finishedReason); or parks (parkCommand). parkNode,
                           the node ids, scopeOf.
  graph/context.ts         StepContext (below), beginStep, beginWait,
                           uncommittedStep, recorders.
  graph/wait.ts            waitNode(nodeId): the one wait node of Agent
                           nodes, Decisions decided by a model, and Wait
                           nodes. Answers: wake, signal, resume.
  graph/nodes/agent.ts     agent node
  graph/nodes/command.ts
  graph/nodes/decision.ts  decision node: routes on the step; a chooser
                           per `by` gets the option.
  graph/nodes/choosers/    person.ts (the Gate: the node opens it, its ask
                           node interrupts), rule.ts (JSONata rules),
                           model.ts (the decider).
  graph/nodes/call.ts      the Call node: runs its flow once, or hands
                           over to call-each.ts
  graph/nodes/call-each.ts the per-element loop of a Call with `each`
                           (one element per super-step)
  graph/nodes/body.ts      What a Call does once and per element: bodyGraph,
  graph/nodes/value.ts     value node, the Decision's twin: routes on the
                           step; a producer per `by` makes the data, which
                           is checked against the output schema.
  graph/nodes/producers/   rule.ts (one JSONata expression), model.ts (the
                           decider's text adapter, `chat()` with the
                           schema; waits like a model Decision).
  graph/nodes/wait.ts      Wait node: works out the wake time (a duration,
                           a time, a command poll, a signal), appends
                           WaitStarted and parks at its wait node; a wake
                           ends it done or timeout, or sleeps again.
                           runBody (a called flow as a subgraph of the node)
                           and BodyEnd (how the body ended).
  ../each.ts               the pure parts of a Call with `each`: list items
                           from a source, item facts, the step's outputs
  graph/runner.ts          Per-run driver: start, continueRun, resume,
                           reenter (reentryUpdate for threads with no
                           checkpoint), wake, stop, closeParked. Streams the
                           graph, publishes to the bus, reacts to
                           interrupts, owns slots and wake timers, and prunes
                           a finished run's thread to its latest checkpoint.
  graph/test-support.ts    Graph-level test helpers: a compiled flow on a
                           MemorySaver, drive() collecting the root's
                           interrupts and custom events.
  graph/node-test-support.ts
                           The same for one node: agent(), command(),
                           edge(), flowOf(), startRun().
  engine.ts                Projects, flows, schedules, gates, runs CRUD;
                           startRun/stopRun/resumeRun/resolveGate/watchRun
                           validate, write the run-level facts and hand the
                           thread to the runner. The walk, frames, scopes,
                           resume points, beginWait/wake/closeParked of the
                           old engine are gone.
  events.ts                Unchanged payloads and derivations for the read
                           model. Derivations only the old walk used are
                           deleted.
```

## Rules

1. **One thread per run, one compiled graph per run.** The runner compiles
   from the run's flow snapshot and its called flows (`run.flowJson`,
   `calledFlowsJson`), and caches the compiled graph by run id.
2. **Only a finished run reaches END.** `failed`, `stopped` and
   `needs-input`-without-edge park the thread: the node appends its
   `StepEnded` and returns `goto: park__<nodeId>`; the park node calls
   `interrupt({ kind: "parked", ... })`. The runner appends `RunEnded`
   when it sees that interrupt. A resume is `Command({ resume })` and
   re-enters the node. This is what makes "resume at the last step's node,
   inside a Call with `each` at the same item" free at any depth.
3. **The event log is written exactly as before.** Same payloads, same
   order: `StepStarted`, `SessionStarted`, `HarnessSessionAssigned`,
   `SessionEnded`, `StepEnded`, `EdgeTaken`, `GateOpened`, `WaitStarted`,
   `WaitEnded`, `FlowCalled`, `ItemsRead`, `ItemStarted`, `ItemBlocked`,
   `ItemEnded`, `RunResumed`, `RunEnded`. The
   `step` and `agent_session` rows and the transcript files too. The API,
   the derivations in `events.ts` and the web app keep working unchanged.
4. **Code before `interrupt()` re-runs on resume.** Only the wait, park
   and ask nodes interrupt, and nothing before their `interrupt()` call
   has side effects. Everything else happens in the step node, which runs
   once per visit. A node's writes before an `interrupt()` are never
   committed, so a fact that must survive the park is committed by one
   node and the next node interrupts (the Gate's open and ask nodes).
5. **Mid-step facts come from the event log on re-entry.** A node's state
   update commits when it returns, so after a daemon death the Agent node
   re-runs from the last checkpoint. It finds its step id in
   `state.pending` (or the open step of that node in the log) and
   continues the harness session the log assigned
   (`HarnessSessionAssigned`). What the checkpoint holds for sure, the
   walk reads there: the inputs, the stop time (`stopAt`, cleared by a
   resume's `Command` update), node outputs (also the session an Agent
   node with `session: "resume"` continues, and a finished body's
   outputs), a waiting step's streak (`pending.streak`), an open Gate
   (`pending.kind === "gate"`), the wait a wake ends (the interrupt).
   The log is the read model for people and the crash-recovery source.
6. **Scopes.** A Call body is a subgraph invoked from the
   node with the config passed through (so it checkpoints under the node's
   namespace). The scope `{ parentStepId, itemId }` travels in
   `config.configurable.scope`; body nodes stamp it on their events as before.
7. **Stop.** The runner holds an `AbortController` per running run; nodes
   pass its signal to harnesses and commands. An aborted step ends
   `stopped` and parks. A stop while parked (wait or Gate) appends
   `StepEnded stopped` and `RunEnded stopped` from the runner; the thread
   stays at its interrupt. `stopRun({ when: "after-step" })` appends
   `StopAfterStepRequested`; every step node checks it (and `stopAt`, and
   the step cap) on entry before `StepStarted`, and parks `stopped` with the
   same reasons as before. The stop time is the state's: the start input
   sets `stopAt`, a resume past it writes it null, and a body reads its
   caller's through `configurable.stopAt` (set on every invoke, because a
   resume's update reaches the root namespace only).
8. **Waits.** The Agent node plans the wait with `planWait` as before,
   from the streak the pending wait carries (`pending.streak`: how many
   waits for this reason, and when the first began), appends
   `WaitStarted`, records the transcript `wait` entry and returns
   `goto: wait__<nodeId>`; the wait node interrupts
   `{ kind: "wait", until, reason }`. The runner schedules the wake timer
   from the interrupt (and rebuilds timers from `deriveSleep` at startup).
   A wake is `Command({ resume: { kind: "wake", early, prompt } })`; the
   Agent node re-enters with `pending` and continues the session.
   A Wait node parks the same way with its own `until` (`graph/nodes/wait.ts`,
   below): the four kinds are `WaitReason`s next to the policy's two, a
   wait with no time (a signal with no timeout) has `until: null` and no
   timer, and a signal is `Command({ resume: { kind: "signal", name } })`
   through the same `runner.wake` (`Engine.signalRun`).
9. **Resume mapping** (`Engine.resumeRun`): stopped or failed → the thread
   is parked → `resume: { kind: "resume", prompt }`. Interrupted (daemon
   died) → the last checkpoint is before the node → `invoke(null)` re-runs
   it (rule 5). Sleeping → wake early. Stopped while at a Gate →
   `resume: { kind: "reopen" }` and the Gate asks again (it loops on
   `interrupt()` until it gets a choice). `RunResumed` is appended by the
   engine before any of these.
10. **Finish.** When the root stream ends with `state.ended.status ===
    "finished"`, the runner appends `RunEnded finished` with the reason
    the old walk used (`Ended at node "x" with "y".` for a non-`pass`
    chosen end), then prunes the thread to its latest checkpoint
    (`saver.pruneThread`: the older root checkpoints and the body
    namespaces go). The history was the walk's bookkeeping and the event
    log is the record; the final state is what `resumeRun` of a finished
    run re-enters on: `Command({ goto, update: { ended: null, pending:
    null } })` with the last step's visit taken back, so its node reopens
    the step (rule 9).
11. **Durability** is `"sync"`: the checkpoint is written before the next
    node starts. Subgraphs inherit it through the config `runBody` passes
    on, as they inherit the drive's `recursionLimit`
    (`Number.MAX_SAFE_INTEGER`: every node visit, park, wait and Call
    element is one super-step, and the walk's own step cap is enforced by
    `beginStep` from the log, not by the graph).
12. **Recovery at startup** keeps `recoverInterruptedWork`'s facts: open
    sessions, steps and runs become `interrupted`; sleeping runs get their
    timers back; open Gates stay; and the daemon resumes interrupted runs
    itself under the same policy as before, now by `invoke(null)`.
13. **A Call with `each`** (the For Each node until flow version 4) keeps its semantics: sources json, command and files;
    `blockersFirst`/`nextItem` ordering; blocked items; per-item
    branches on top of the last finished element (`branch: "per-item"`)
    or the shared branch; `haltOn`; `maxItems`; the list is read again
    before each element. One element per super-step: the node runs the
    element's body and jumps back to itself, so the cursor is checkpointed
    after each element. Only the cursor (`{ index }`, the last element that
    ended) lives in `state.loops`; the list, the item states and the
    results come from the log (`ItemsRead`, `ItemStarted`, `ItemEnded`), so
    the checkpoints stay small.
14. **Tests.** `bun test` in `packages/engine` must pass. A test may change
    only where it asserted a mechanism that no longer exists (for example a
    resume point derivation); every such change is listed in the PR.

## Where the code deviates from the rules as written

Decisions taken while implementing, from the code and its comments:

- **A body failure does not park the run** (`graph/nodes/body.ts`). A body
  step that fails inside a Call parks the *body's* thread
  namespace (rule 2), but `runBody` swallows that interrupt: the Call
  step ends `fail`, or the element ends `ItemEnded failed` and the items
  that depend on it block, and the walk goes on, as before. The parked
  namespace is never invoked again (the next invoke of the node is a new
  task, so a new namespace); bodies compile without `checkpointer: true`.
  A stop, a step-cap abort or a wait or Gate inside the body does rethrow
  the interrupt, so those park or pause the run at any depth.
- **Decision and Gate are one node, with the chooser behind a seam**
  (`graph/nodes/decision.ts`). The node routes on its step's end; who
  gets the option is `node.by`: `choosers/person.ts` (the Gate),
  `choosers/rule.ts` (JSONata rules) or `choosers/model.ts` (the decider).
  Every chooser ends its step with `{ outcome, note, visit }`. The option
  check is one function in `packages/flows` (`optionProblem`), shared by
  the choosers, `resolveGate` and the decider's `decide` tool. The inbox,
  run status `waiting`, `listGates` and `resolveGate` key on the Gate the
  step opened (`GateOpened`), not on a node type.
- **A Gate is two graph nodes** (`choosers/person.ts`, `compile.ts`). The
  node opens the Gate (`StepStarted`, `GateOpened`, the transcript
  `gate-open`) and commits it as `pending: { kind: "gate", stepId,
  nodeId, visit, question, choices }` with a jump to its ask node
  `ask__<id>`, which interrupts with that Gate. So the checkpoint knows
  the Gate is open, not only the log (a node's writes before an
  `interrupt()` are never committed). The answer ends the step in the ask
  node through a quiet `beginStep({ kind: "continue", quiet: true })`,
  which announces no start, and routes. `{ kind: "reopen" }` (a resume
  after a stop at the Gate) clears `pending` and jumps back to the node,
  which asks again with `StepStarted` (visit + 1), `GateOpened` and
  `gate-open`, as the old `closeParked` path did. The log guard in the
  node (`uncommittedStep` with the Gate asked) is the crash-only path: a
  daemon that dies between `GateOpened` and the checkpoint commit must
  not open a second Gate on the re-run. A Gate starts no time budget: it
  waits as long as it must.
- **A rule Decision is pure** (`choosers/rule.ts`). It opens its step,
  evaluates each option's `when` in order and ends the step in one go,
  with no session, no cost and no wait node. A step the daemon left open
  is not continued: recovery ends it `interrupted` and the node runs a new
  visit on the same values. The transcript gets one `rule` entry with what
  each rule gave.
- **A model Decision has a wait node too** (`choosers/model.ts`,
  `wait__<id>`, the shared `waitNode`). A usage limit or a network failure
  of the decider plans a wait with `beginWait` and parks at the wait node,
  like the Agent node; a give-up ends the step `error`. A parked or
  interrupted model Decision step starts a new visit: it has no session to
  reopen.
- **A Value node is a Decision with data instead of a label**
  (`graph/nodes/value.ts`, `producers/`). The node routes on its step's end;
  `node.by` picks the producer: `producers/rule.ts` evaluates one JSONata
  expression (pure, no wait node), `producers/model.ts` asks the decider's
  text adapter (`Decider.value`, TanStack AI `chat()` with the output
  schema) and shares the model chooser's entry and wait rules (`entryOf`,
  `withinGrace`, `wait__<id>`). Both end the step through one place
  (`endWithValue`): the data is checked against the output schema with ajv
  (`output-schema.ts`), `pass` with the data, or `fail` with why in `note`.
  A schema that does not compile, or no decider, ends `error`. Only a
  decider with a text adapter can make a value (`valueDeciderNameSchema` in
  flows, `DECIDER_ADAPTERS[name].value` in agents): TypeSafe and Ollaya are
  evaluate adapters only.
- **A Wait node is a step that is all wait** (`graph/nodes/wait.ts`,
  2026-10-17). It uses the shared `waitNode` and the pending wait's shape
  as the Agent node does, with no field of its own: the streak's `since`
  is when the wait began (the deadline `since + timeoutMinutes` and
  `waited_minutes` count from it) and `count` how often it slept; the wake
  time is cut to the deadline, so the timeout fires as a wake and the node
  ends `timeout`. `beginStep` starts no timer for it, and the step's log
  path is set when it polls a command. On a wake it runs
  `beginStep({ kind: "continue" })`, so the entry checks do not run: it
  checks the stop time itself and parks `stopped` with the stop-time reason,
  as a new step would. A `duration` or `time` wake, early or not, ends
  `done`; a `command` wake runs the command again; a `signal` wake that is
  not the signal (a timer at the deadline, a person's "wake now") sleeps on.
  `done` without an edge is a chosen end, `timeout` a failure. A parked or
  interrupted Wait step starts a new visit, as a Command does.
- **`resumeRun` of a thread that ended or never ran re-enters with a
  `Command({ goto, update })`** (`runner.reenter`). A finished run (rule
  10) or a run from before this engine has no checkpoint at an interrupt,
  so the engine jumps to the top-level node the log points at instead of
  `Command({ resume })` (rule 9). A finished run re-enters on its own
  latest checkpoint: `ended` and `pending` cleared. A thread with no
  checkpoint is seeded from the log (`reentryUpdate`: `inputs`, `stopAt`,
  `visits`, `nodes`, `traversals`), so `uncommittedStep` and templates
  behave. Either way the one step left uncommitted is the last top-level
  step the walk did not move on from (`reenteredNode`), which the node
  reopens as the old walk did (an Agent continues its session with the
  resume prompt).
- **A continued or reopened step never parks at entry** (`beginStep`).
  The entry checks (a stop, stop after step, the stop time, the step cap)
  run for a new visit only; a step that is already in the log enters the
  node body with the aborted signal and ends `stopped` there, with its
  harness session, so a later resume can reopen it.
- **A step recovery ended after a wake is reopened** (`StepReopened`),
  not continued, in the Agent node and the model chooser as in
  `continueStep` for a Call, so the log keeps one open step to end and the read
  model shows the step's real outcome and cost.
- **The runner publishes `status-changed` on step chunks**
  (`runner.onCustom`). The `step-started` and `step-ended` custom stream
  chunks (`RunEvent`) make the runner publish `{ kind: "status-changed" }`
  on the bus; transcript entries reach the bus from the recorder already.
- **`resolveGate` waits for the step to end** (`engine.ts`). It reserves a
  slot, resumes the thread with `{ kind: "gate", choice, note }` and
  returns once the log has the step's `StepEnded`, so the run no longer
  waits when the caller looks again. A full run cap leaves the Gate open.

## StepContext (what a node factory gets)

```ts
type StepContext = {
  db: Database;
  run: RunRow;                      // id, projectId, worktreePath, branch, baseRef, flow snapshot
  flow: Flow;                        // the flow this graph was compiled from
  flowName: string;                  // {{run.flow}}
  flows: Record<string, Flow>;       // called flows by name
  policy(): ResolvedPolicy;          // resolved at each use, like settings()
  log: RunLog;                       // appendEvent; events(runId) for lookups
  bus: RunBus;
  recorder(stepId, path): Recorder;  // transcript writer, as openRecorder today
  harnessFor(name): AgentHarness | undefined;
  decider?: Decider;
  mcpServersFor(node): Promise<McpExpansion>;
  signal(): AbortSignal;             // the run's abort signal
  now(): number; minuteMs: number;
  dataDir: string;
  settings(): RunSettings;
};
```

A node factory is `(node, ctx) => (state, config) => Promise<Command>`.
