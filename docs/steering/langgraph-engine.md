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
  graph/context.ts         StepContext (below), the recorders, the template
                           context, stopAtOf.
  graph/step-runner.ts     The step runner (below): runStep() owns the step
                           lifecycle every node shares, from the resume
                           point to route(); beginStep/OpenStep is the lower
                           seam for the loop-shaped nodes (Call, Call with
                           `each`, the Gate).
  graph/resume-point.ts    The one resume point (below): resumePoint()
                           decides how a node re-enters (new, continue,
                           reopen) from the checkpoint and the log, per
                           kind rules (RESUME_RULES); uncommittedStep,
                           latestStepOf, sessionOf. The daemon side of the
                           same question: reenteredNode, reentryUpdate,
                           resumeTarget.
  graph/sleep.ts           The sleep module (below): sleep() plans a wait
                           (the policy's, or a Wait node's own) and persists
                           it; waitNode(nodeId) is the one wait node;
                           pendingWaitOf reads the pending wait (old
                           checkpoints too); createSleeps(deps) is the
                           daemon side: the timers, wake(runId, how),
                           restore(runId, events).
  graph/interrupt.ts       interruptNode(spec): the one interrupting graph
                           node; the wait, park and ask nodes give it the
                           copy of pending the interrupt carries and what
                           the answer does.
  graph/nodes/agent.ts     agent node: the body runSession
  graph/nodes/command.ts   command node: the body runShell
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
                           a time, a command poll, a signal) and asks the
                           sleep module to sleep; a wake ends it done or
                           timeout, or sleeps again.
  graph/nodes/tool.ts      tool node: one tools/call on a Connection's MCP
                           server through @nightshift/agents/mcp, the
                           Connection resolved by mcpServersFor as for an
                           Agent node. No wait node: a transport failure
                           is `fail`.
                           runBody (a called flow as a subgraph of the node)
                           and BodyEnd (how the body ended).
  ../each.ts               the pure parts of a Call with `each`: list items
                           from a source, item facts, the step's outputs
  graph/runner.ts          Per-run driver: start, continueRun, resume,
                           reenter (seeded by reentryUpdate for threads with
                           no checkpoint), stop, closeParked. Streams the
                           graph, publishes to the bus, reacts to
                           interrupts, owns the slots, gives the sleep module
                           its thread seam (runner.sleeps), and prunes a
                           finished run's thread to its latest checkpoint.
  graph/test-support.ts    Graph-level test helpers: a compiled flow on a
                           MemorySaver, drive() collecting the root's
                           interrupts and custom events.
  graph/node-test-support.ts
                           The same for one node: agent(), command(),
                           edge(), flowOf(), startRun().
  engine.ts                The composition root: createEngine wires the
                           runner, recovery, run start, the read model and
                           the scheduler, each behind a small seam that
                           takes its dependencies (db, log, runner, bus,
                           settings, clock). Keeps the projects, flows and
                           schedules CRUD, and stopRun, resolveGate and
                           signalRun, which write one run-level fact each.
  run-start.ts             Run start. prepareRun loads and validates the
                           flow and its called flows, resolves profiles and
                           asks every requirement in REQUIREMENTS (one
                           function per requirement: connections, CLI tools
                           defined and installed, harnesses, the decider)
                           whether this daemon has what the nodes need; it
                           writes nothing. createRunStart(deps).start holds
                           the slot, creates the worktree and the run row,
                           appends RunStarted and WorktreeCreated and hands
                           the thread to the runner.
  recovery.ts              createRecovery(deps): recoverInterruptedWork
                           (a dead daemon's open sessions, steps and runs
                           become interrupted; sleeping runs get their
                           timers back through sleeps.restore; after a
                           grace period the daemon
                           resumes the rest unless daemonResumeBlock says
                           why not), resume (a person's and the daemon's,
                           mapped from the thread's checkpoint through
                           resumeTarget; appends RunResumed before the
                           thread moves) and onSlotFreed (the queue on a
                           full run cap).
  read-model.ts            What people see of a run, from the log: runFacts,
                           toSummary, toStepSummary, toRunDetail,
                           takeOverCommand, the flow snapshot parsers;
                           createReadModel(deps) adds listRuns, getRun,
                           listGates, runStatus, watch and untilLogged.
                           Reads only.
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
8. **Waits.** One module owns every wait (`graph/sleep.ts`, below). A body
   that hits a usage limit or loses the network returns a wait request;
   the step runner hands it to `sleep()`, which plans the wait with
   `planWait` as before, from the streak the pending wait carries
   (`pending.streak`: how many waits for this reason, and when the first
   began), appends `WaitStarted`, records the transcript `wait` entry and
   parks at `wait__<nodeId>`; the wait node interrupts
   `{ kind: "wait", until, reason }`. The runner gives the interrupt to
   `sleeps.schedule` for the wake timer (and recovery rebuilds the timers
   from `deriveSleep` through `sleeps.restore` at startup). A wake is
   `sleeps.wake(runId, how)`: `WaitEnded`, the transcript `wake`, then
   `Command({ resume: { kind: "wake", early, prompt } })`; the Agent node
   re-enters with `pending` and continues the session.
   A Wait node sleeps the same way with its own `until` (`graph/nodes/wait.ts`,
   below): its body returns `{ kind: "sleep" }` with the time and its
   deadline, the four kinds are `WaitReason`s next to the policy's two, a
   wait with no time (a signal with no timeout) has `until: null` and no
   timer, and a signal is `Command({ resume: { kind: "signal", name } })`
   through the same `sleeps.wake` (`Engine.signalRun`).
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
  `gate-open`, as the old `closeParked` path did. The resume point's
  `asked-gate` rule (`RESUME_RULES.gate`) is the crash-only path: a
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
  `wait__<id>`, the sleep module's `waitNode`). A usage limit or a network
  failure of the decider is a wait request the sleep module plans and parks at the wait node,
  like the Agent node; a give-up ends the step `error`. A parked or
  interrupted model Decision step starts a new visit: it has no session to
  reopen.
- **A Value node is a Decision with data instead of a label**
  (`graph/nodes/value.ts`, `producers/`). The node routes on its step's end;
  `node.by` picks the producer: `producers/rule.ts` evaluates one JSONata
  expression (pure, no wait node), `producers/model.ts` asks the decider's
  text adapter (`Decider.value`, TanStack AI `chat()` with the output
  schema) and shares the model chooser's entry and wait rules
  (`RESUME_RULES.model`, `withinGrace`, `wait__<id>`). Both end the step through one place
  (`endWithValue`): the data is checked against the output schema with ajv
  (`output-schema.ts`), `pass` with the data, or `fail` with why in `note`.
  A schema that does not compile, or no decider, ends `error`. Only a
  decider with a text adapter can make a value (`valueDeciderNameSchema` in
  flows, `DECIDER_ADAPTERS[name].value` in agents): TypeSafe and Ollaya are
  evaluate adapters only.
- **A Wait node is a step that is all wait** (`graph/nodes/wait.ts`,
  2026-10-17). It sleeps through the sleep module as the Agent node does.
  Its pending wait has `session: null`: the step continues nothing. The
  streak's `since` is when the wait began (the deadline `since +
  timeoutMinutes` and `waited_minutes` count from it) and `count` how
  often it slept; the sleep module cuts the wake time to the deadline the
  node gives it, so the timeout fires as a wake and the node ends
  `timeout`. `beginStep` starts no timer for it, and the step's log path
  is set when it polls a command. On a wake the step continues, so
  the entry checks do not run: the step runner checks the stop time and
  parks `stopped` with the stop-time reason, as a new step would, with the
  `waited_minutes` the node gives it. A `duration` or `time` wake, early
  or not, ends `done`; a `command` wake runs the command again; a `signal` wake that is
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
  not continued, for every node with a wait node (the Agent node, the
  model chooser and producer, the Wait node), so the log keeps one open
  step to end and the read model shows the step's real outcome and cost.
  This is the resume point's one rule for an existing step (below).
- **The runner publishes `status-changed` on step chunks**
  (`runner.onCustom`). The `step-started` and `step-ended` custom stream
  chunks (`RunEvent`) make the runner publish `{ kind: "status-changed" }`
  on the bus; transcript entries reach the bus from the recorder already.
- **`resolveGate` waits for the step to end** (`engine.ts`). It reserves a
  slot, resumes the thread with `{ kind: "gate", choice, note }` and
  returns once the log has the step's `StepEnded`, so the run no longer
  waits when the caller looks again. A full run cap leaves the Gate open.

## The resume point (`graph/resume-point.ts`)

One module answers one question for every node: how does the node
re-enter after a park, a wake, a resume or a daemon death? It is a deep
module behind a small interface. `resumePoint(node, state, events, scope,
rules)` returns `{ kind: "new" }`, `{ kind: "continue", step }` or
`{ kind: "reopen", step, prompt }`. `entryOf(point)` turns that into the
`StepStart` for `beginStep`. The module appends nothing: it decides, and
`beginStep` writes the log as before (rule 3).

The rule, in this order:

1. `pending` is this node's wait that ended: the step continues while it
   is open in the log, and is reopened when recovery ended it after the
   wake. The prompt is the latest `RunResumed` for the step, else the
   wait's own follow-up.
2. `pending` is this node's parked step and a person resumed: the step is
   taken up when the kind's `parked` rule says so, else a new visit. The
   prompt is the resume's, else "Continue where you left off.".
3. The node loops over elements (`loops`): its latest step in this scope
   continues (open) or is reopened (ended).
4. The log has a step of this node in this scope that the checkpoint never
   saw (`uncommittedStep`, rule 5): taken up when the kind's `crashed`
   rule says so, else a new visit.
5. Else a new visit.

The prompt and the harness session are set only for a step with a harness
session to continue, so a Call or Decision step reopens with `prompt:
null`, as before.

The node kinds differ only in which existing step they take up. That is
all `ResumeRules` lets them say (`RESUME_RULES`):

| Kind | `parked` | `crashed` |
| --- | --- | --- |
| Agent | `with-session`: reopen with the resume prompt | `with-session`: reopen, open or ended (the harness process is gone) |
| Decision or Value by a model | `new` | `new` |
| Call once | `new` | `take-up`: continue open, reopen ended |
| Call with `each` | `cut-short`: reopen a `stopped`, `error` or `interrupted` step; an exhausted loop starts over | `take-up`, and `loop` for the cursor |
| Gate | `new` | `asked-gate`: continue only while open with `GateOpened` after its latest opening |
| Wait | `new` | `new` |
| Command, Tool, Decision or Value by a rule (`fresh`) | `new` | `new` |

The daemon side lives next to it, on the same helpers: `resumeTarget`
(what `RunResumed` records: the node, and the Agent step whose harness
session the resume continues, `sessionOf`), `reenteredNode` (the last
top-level step the walk did not move on from) and `reentryUpdate` (the
seed state of a thread with no checkpoint). The engine promises in
`RunResumed` what the node finds when it re-enters, by construction.
`graph/resume-point.test.ts` holds the rule as a table: one situation,
every kind.

## The step runner (`graph/step-runner.ts`)

One module runs one visit of every step node: `runStep(ctx, node, state,
config, spec)`. It is a deep module behind a small interface. The node
gives a `StepSpec`: its resume rules (`RESUME_RULES`), its body, and the
outputs of a step that ends before the body spoke. The runner does the
rest, in this order:

1. The entry: `resumePoint` decides new, continue or reopen.
2. The entry checks, for a new visit only: a stop of the run, a stop after
   the running step, the stop time, the step cap. Each parks the run before
   the step (`beginStep`).
3. The `step` row, `StepStarted` or `StepReopened`, the transcript
   recorder, the step and idle timers.
4. A continued step past the stop time ends `stopped` and parks with the
   stop-time reason. The body does not run.
5. The body, with a `StepHandle`. The runner catches what it throws: the
   step ends `error` with the message.
6. The end. The body returns a `BodyResult`:
   - `end`: `StepEnded` with the outcome, the outputs, the error and the
     cost; then `route()`.
   - `aborted`: the body saw its signal abort. The runner reads the reason:
     `stopped` for a person's stop, `error` with why for the time budget
     or no activity. The outputs the body had are kept.
   - `wait`: a usage limit or a network failure. The runner calls the sleep
     module's `sleep()` (the one call site) and returns its park at the
     wait node, or ends the step `stopped` (the wait would pass the stop
     time) or `error` (the grace is spent).
   - `sleep`: a Wait node's own wait, with its time and deadline. The same
     `sleep()` persists it and parks at the wait node, the step open.

The `StepHandle` a body gets is what a body reads and records: `stepId`,
`visit`, `existing`, `events`, `tctx`, `signal`, `record()`, `touch()` and
`session()`. `session()` records a harness session: the `agent_session`
row, `SessionStarted`, `HarnessSessionAssigned`, `SessionEnded`. No node
module writes a database row.

The node modules keep their body only: `runSession` (Agent), `runShell`
(Command), `callTool` (Tool), `decide` (Decision by a model), `make`
(Value by a model), the rule chooser and producer, and the Wait node's
`startWait` and `continueWait`. The Decision and Value seams stay: a
`Chooser` or `Producer` is a `NodeAction` that runs `runStep` with its
own body.

Three nodes do not fit `runStep`: a Call once, a Call with `each` and the
Gate. Their step stays open across a subgraph or an interrupt, or spans
many super-steps, or ends in another graph node. They open and close the
step through the lower seam, `beginStep` and `OpenStep` (`end()`,
`leaveOpen()`, `opened`), in the same module.

The log is written exactly as before (rule 3). `graph/step-runner.test.ts`
holds the lifecycle as a table: a new or a continued entry, crossed with
what the run and the body do.

## The sleep module (`graph/sleep.ts`)

One module owns a sleep from the step that asks for it to the step that
continues after it. It is a deep module behind two small interfaces: one
for the graph side, one for the daemon side.

The graph side is `sleep(ctx, node, state, config, step, request)`. The
request is a policy wait (`{ kind: "policy" }`: the reason, the message,
`resetAt`, the harness session) or a Wait node's own wait (`{ kind: "own"
}`: the reason, `until`, the deadline, the message, a signal name). The
module:

1. Finds the streak: the pending wait's when the step continues after a
   wait for the same reason, else a new one.
2. Plans the wait. A policy wait goes through `planWait` (`policy.ts`,
   pure), and is refused when it would pass the stop time (`stop-time`) or
   spend the network grace (`give-up`). An own wait is cut to its deadline.
3. Persists it: `WaitStarted`, the transcript `wait` entry, the bus, the
   step left open, and the `Command` that parks at the wait node with
   `pending` and the node's visit.

`waitNode(nodeId)` is the one wait node (`interruptNode`). It interrupts
with the sleep and answers a `wake` (the step continues, with the wake's
prompt when a person gave one), a `signal` (`pending.signal` is set; the
Wait node reads it) and a `resume` (the run was stopped while it slept:
the step is parked as stopped and the node reopens or restarts it).

The daemon side is `createSleeps(deps)`, one per runner, with the runner's
thread seam as its dependency (where the thread is, a slot, a drive into
the wait node under `exclusive`). `schedule(runId, until)` sets the timer;
`restore(runId, events)` sets it from `deriveSleep` for a run that slept
when the last daemon died (the log stays the restart source); `wake(runId,
how)` checks that the run still sleeps in the log and that the wait is the
interrupt the thread sits at, appends `WaitEnded` and the transcript
`wake`, and drives the thread with `{ kind: "wake" }` or `{ kind: "signal"
}`; a full run cap queues a timer's wake (`drain()` on a freed slot) and
refuses a person's. `forget(runId)` drops the timer and the queued wake of
a run that was stopped while it slept (`closeParked`).

The pending wait has one shape (`PendingWait`): the step, the visit, the
reason, `until`, the message, the streak, `session` (what a policy wait
continues: the harness session and the follow-up prompt; null for a Wait
node) and `signal`. A checkpoint written before 2026-10-19 holds the
continuation flat (`harnessSessionId`, `prompt`, and a `resetAt` nobody
read). `pendingWaitOf` is the one reader of a pending wait and reads both
shapes; a run that slept across the upgrade continues, and its next wake
writes today's shape. `graph/sleep.test.ts` runs plan, persist, interrupt
and wake (the timer, a signal, an early resume, the stop time, a full run
cap, a new daemon's restore) for both kinds of wait.

The three interrupting graph nodes share one skeleton
(`graph/interrupt.ts`, `interruptNode`): check `pending` is this node's,
interrupt with a copy of it, jump back on the answer. The wait node, the
park node and the Gate's ask node give it only the copy the interrupt
carries and what the answer does. The interrupt payloads (`Parked`) did
not change.

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
Only the step runner reads `db`: it writes the `step` and `agent_session`
rows. The node modules read the rest.
