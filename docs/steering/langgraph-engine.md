# The run engine on LangGraph

**Status:** implemented (2026-10-16). **Spike:** `docs/research/langgraph-spike.md`.
**Probes:** `docs/research/langgraph-probe.md`.

Night Shift's run engine (`packages/engine`) runs its control flow and
durability on LangGraph (`@langchain/langgraph`). A run is one LangGraph
thread (thread id = run id). The flow the run snapshotted at start compiles
into a `StateGraph`; every flow node is one graph node; LangGraph checkpoints
the run state in Night Shift's own database after every node; the two ways
a run parks (a usage-limit or network wait, a Gate) and the three ways a run
ends early (failed, stopped, needs a person) are LangGraph `interrupt`s, so
a resume always lands back at the exact node, at any depth.

What did **not** change: the `Engine` interface (`types.ts`), the API, the
web app, the event log as the read model, transcripts on disk, the bus,
the scheduler, worktrees, leases, run bundles, settings, profiles,
connections, the GitHub tools and the harnesses. The existing engine test
suites were the acceptance criteria.

## Layering

```
packages/engine/src/
  graph/state.ts           RunState (zod): inputs, nodes, visits, traversals,
                           loops, pending, ended. Also the typed
                           payloads that cross the graph's boundary: Parked
                           (an interrupt), ResumeValue, RunEvent (custom
                           stream chunks).
  graph/checkpointer.ts    LibsqlSaver: BaseCheckpointSaver on db.$client.
                           Tables lg_checkpoint and lg_write (drizzle schema in
                           packages/db, migration
                           20261016155422_langgraph_checkpoints).
  graph/compile.ts         compileFlow(flow, ctx): StateGraph. START →
                           flow.start; every flow node plus its park node
                           park__<id>; Agent and Decision nodes also get a
                           wait node wait__<id>. No static edges.
  graph/route.ts           route(): picks the edge with `nextEdge`, logs
                           EdgeTaken and returns `new Command({ update,
                           goto })`; or ends the flow (isChosenEnd,
                           finishedReason); or parks (parkCommand). parkNode,
                           the node ids, scopeOf.
  graph/context.ts         StepContext (below), beginStep, beginWait,
                           uncommittedStep, recorders, the EffectJournal.
  graph/nodes/agent.ts     agent node + agentWaitNode
  graph/nodes/command.ts
  graph/nodes/decision.ts  decision node + decisionWaitNode
  graph/nodes/gate.ts
  graph/nodes/subflow.ts
  graph/nodes/foreach.ts
  graph/nodes/body.ts      What Subflow and For Each share: bodyGraph,
                           runBody (a called flow as a subgraph of the node)
                           and BodyEnd (how the body ended).
  graph/runner.ts          Per-run driver: start, continueRun, resume,
                           reenter (reentryUpdate), wake, stop, closeParked.
                           Streams the graph, publishes to the bus, reacts
                           to interrupts, owns slots and wake timers, and
                           prunes a finished run's thread.
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
   inside a For Each at the same item" free at any depth.
3. **The event log is written exactly as before.** Same payloads, same
   order: `StepStarted`, `SessionStarted`, `HarnessSessionAssigned`,
   `SessionEnded`, `StepEnded`, `EdgeTaken`, `GateOpened`, `WaitStarted`,
   `WaitEnded`, `FlowCalled`, `ItemsRead`, `ItemStarted`, `ItemBlocked`,
   `ItemEnded`, `SideEffectStarted/Ended`, `RunResumed`, `RunEnded`. The
   `step` and `agent_session` rows and the transcript files too. The API,
   the derivations in `events.ts` and the web app keep working unchanged.
4. **Code before `interrupt()` re-runs on resume.** Only the wait, park
   and gate nodes interrupt, and nothing before their `interrupt()` call
   has side effects. Everything else happens in the step node, which runs
   once per visit.
5. **Mid-step facts come from the event log on re-entry.** A node's state
   update commits when it returns, so after a daemon death the Agent node
   re-runs from the last checkpoint. It finds its step id in
   `state.pending` (or the open step of that node in the log) and
   continues the harness session the log assigned
   (`HarnessSessionAssigned`). The `EffectJournal` keeps working the same way.
6. **Scopes.** A Subflow or For Each body is a subgraph invoked from the
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
   same reasons as before.
8. **Waits.** The Agent node plans the wait with `planWait` as before,
   appends `WaitStarted`, records the transcript `wait` entry and returns
   `goto: wait__<nodeId>`; the wait node interrupts
   `{ kind: "wait", until, reason }`. The runner schedules the wake timer
   from the interrupt (and rebuilds timers from `deriveSleep` at startup).
   A wake is `Command({ resume: { kind: "wake", early, prompt } })`; the
   Agent node re-enters with `pending` and continues the session.
9. **Resume mapping** (`Engine.resumeRun`): stopped or failed → the thread
   is parked → `resume: { kind: "resume", prompt }`. Interrupted (daemon
   died) → the last checkpoint is before the node → `invoke(null)` re-runs
   it (rule 5). Sleeping → wake early. Stopped while at a Gate →
   `resume: { kind: "reopen" }` and the gate node asks again (it loops on
   `interrupt()` until it gets a choice). `RunResumed` is appended by the
   engine before any of these.
10. **Finish.** When the root stream ends with `state.ended.status ===
    "finished"`, the runner appends `RunEnded finished` with the reason
    the old walk used (`Ended at node "x" with "y".` for a non-`pass`
    chosen end), then deletes the thread's checkpoints and pending writes
    (`saver.deleteThread`). They were the walk's bookkeeping; the event
    log is the record. A finished run is never resumed through its thread:
    `resumeRun` of one finds the thread `fresh` and re-enters it from the
    log (rule 9).
11. **Durability** is `"sync"`: the checkpoint is written before the next
    node starts. Subgraphs inherit it through the config `runBody` passes
    on, as they inherit the drive's `recursionLimit`
    (`Number.MAX_SAFE_INTEGER`: every node visit, park, wait and For Each
    element is one super-step, and the walk's own step cap is enforced by
    `beginStep` from the log, not by the graph).
12. **Recovery at startup** keeps `recoverInterruptedWork`'s facts: open
    sessions, steps and runs become `interrupted`; sleeping runs get their
    timers back; open Gates stay; and the daemon resumes interrupted runs
    itself under the same policy as before, now by `invoke(null)`.
13. **For Each** keeps its semantics: sources json, command, files and
    github; `blockersFirst`/`nextItem` ordering; blocked items; per-item
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
  step that fails inside a Subflow or a For Each parks the *body's* thread
  namespace (rule 2), but `runBody` swallows that interrupt: the Subflow
  step ends `fail`, or the element ends `ItemEnded failed` and the items
  that depend on it block, and the walk goes on, as before. The parked
  namespace is never invoked again (the next invoke of the node is a new
  task, so a new namespace); bodies compile without `checkpointer: true`.
  A stop, a step-cap abort or a wait or Gate inside the body does rethrow
  the interrupt, so those park or pause the run at any depth.
- **A Gate reopened after a stop is a new visit** (`graph/nodes/gate.ts`).
  `{ kind: "reopen" }` asks the Gate again with `StepStarted` (visit + 1),
  `GateOpened` and the transcript `gate-open`, as the old `closeParked`
  path did. The opening is guarded by the log (`uncommittedStep`): a
  re-run that finds the Gate still open logs nothing.
- **The Decision node has a wait node too** (`graph/nodes/decision.ts`,
  `wait__<id>`). A usage limit or a network failure of the decider plans a
  wait with `beginWait` and parks at `decisionWaitNode`, like the Agent
  node; a give-up ends the step `error`. A parked or interrupted Decision
  step starts a new visit: it has no session to reopen.
- **`resumeRun` of a thread that ended or never ran re-enters with a
  `Command({ goto })`** (`runner.reenter`). A run from before this engine,
  or a finished one whose checkpoints were deleted (rule 10), has no
  checkpoint at an interrupt, so the engine jumps to the top-level node
  the log points at instead of `Command({ resume })` (rule 9). The update
  is seeded from the log (`reentryUpdate`: `inputs`, `visits`, `nodes`,
  `traversals`), so `uncommittedStep` and templates behave; the one step
  left uncommitted is the last top-level step the walk did not move on
  from, which the node reopens as the old walk did (an Agent continues
  its session with the resume prompt).
- **A continued or reopened step never parks at entry** (`beginStep`).
  The entry checks (a stop, stop after step, the stop time, the step cap)
  run for a new visit only; a step that is already in the log enters the
  node body with the aborted signal and ends `stopped` there, with its
  harness session, so a later resume can reopen it.
- **A step recovery ended after a wake is reopened** (`StepReopened`),
  not continued, in the Agent and Decision nodes as in `continueStep` for
  Subflow and For Each, so the log keeps one open step to end and the read
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
  readGithubItems?: ...;
  mcpServersFor(node): Promise<McpExpansion>;
  effectJournal(runId, stepId): EffectJournal;
  signal(): AbortSignal;             // the run's abort signal
  now(): number; minuteMs: number;
  dataDir: string;
  settings(): RunSettings;
};
```

A node factory is `(node, ctx) => (state, config) => Promise<Command>`.
