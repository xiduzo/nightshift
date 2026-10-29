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

What did **not** change: the `Engine` interface (`run/engine.ts`), the API, the
web app, the event log as the read model, transcripts on disk, the bus,
the scheduler, worktrees, leases, run bundles, settings, profiles,
connections and the harnesses. The existing engine test
suites were the acceptance criteria.

## Layering

The engine is cut into verticals (`docs/steering/STRUCTURE.md`, section 4).
Each folder of `packages/engine/src/` has an `index.ts` barrel. Code outside
a folder imports only its barrel. A vertical imports only the verticals
below it, from the bottom up:

| Vertical | Holds |
| --- | --- |
| `contract/` | What the engine shares with its callers and the Devices: who acts (`Actor`), a change of Members (`MemberChange`), a run start and its schema (`StartRunInput`, `startRunInputSchema`), where a run can be placed (`Placement`, `OwnDevice`, `NodeToPlace`), and the ports a vertical asks of the devices: the Device rows (`DeviceDirectory`), the Hosts (`Relay`) and the Offer rule of a schedule (`OffersPort`). It imports no other vertical. |
| `run-status/` | A run's status and which actions it allows (`runActions`, `whyNot`), with the refusal they share (`RunRefusal`, one named rule each). It imports nothing: the package entry `@nightshift/engine/run-status` gives it to `@nightshift/client` for the apps. |
| `device-config/` | This computer's Device document: settings, connections and secrets, CLI tools, Agent Profiles, MCP servers. |
| `log/` | The event payloads and append and parse (`events.ts`), the run log in memory (`run-log.ts`), the bus, the run and step rows (`run-row.ts`), the member events, the transcript files and the transcript event types (`step-events.ts`). |
| `read/` | The pure projections of the log (`derive-run.ts`, `derive-steps.ts`), cost (`cost.ts`), the run views (`views.ts`), the read model, the Persons a run names (`people.ts`) and the run bundle. |
| `projects/` | Projects, the Space document that defines them, the git port (`git.ts`: every `git` and `xcode-select` process, with its adapter `systemGit`), the git setup of a project folder, and run worktrees (`createWorktrees(git)`). |
| `flows/` | The flows of the projects in their flow documents (`project-flows.ts`), what a person does with them in a Space (`space-flows.ts`), and the flows a run starts from (`run-flows.ts`). |
| `device/` | The execution port (`Device`), this computer (`local.ts`), commands and tool calls. |
| `graph/` | The flow as a graph, below. |
| `schedules/` | The scheduler and the schedules file of a project (`schedule-files.ts`). |
| `run/` | The composition root (`engine.ts`, with the `Engine` it returns), what it takes (`engine-options.ts`), the port of the other Devices it walks with (`peers.ts`), what a person does in one Space (`space-engine.ts` is the interface, `space.ts` the module), run start, startup recovery, the run actions (`actions.ts`, with the relay to a Walker in `relay.ts`), the other end of a move (`take-over.ts`) and the wake when a Device is back (`wake.ts`). |

No import points up, `import type` included: `scripts/check-verticals.ts`
fails on a cycle between verticals. `contract/` holds only types and the
schema of a run start, and imports no vertical, so every vertical may name
them. The engine's interface (`Engine`, `SpaceEngine`, `EngineOptions`) and
the `Peers` port name the types of many verticals, so they sit in `run/`,
with `createEngine`.

The engine knows no other Device. `Peers` (`run/peers.ts`) is the port
of the other Devices and Hosts: where a step runs (Placement), the Offer
rules, the Host that keeps a Space, and the runs walked elsewhere (their
commands, transcripts and the archive of a moved run). `@nightshift/devices`
implements it (`createPeerEngine`). `createEngine` calls the factory in
`EngineOptions.peers` once, with what it offers the peers (`PeerContext`):
this computer, Projects and their flows, profiles, the run history (rows by
cursor, the ingest, a run's owners and events, what lands), the runs walked
here (walk files, stamps, take over, stop) and `logFact` for the Device and
Offer facts. Never its database, run log or bus: the peers keep their own
rows on their own handle.
The engine's own tests walk with `alonePeers` (`./testing`): a computer
without other Devices. The engine reads the Device rows (`device`,
`host_space`) only through `DeviceDirectory` (`contract/directory.ts`):
this computer's Device id and its owner, the names of Devices, and the
Spaces a Host keeps. `@nightshift/devices` implements it
(`deviceDirectory`). The Space documents need it before the engine exists,
so the daemon makes it first. The engine's own tests use `aloneDirectory`
(`./testing`). The engine reads the auth
tables (`user`, `member`, `organization`) only through functions of
`@nightshift/auth`. `testing/` holds the test
helpers and fixtures. The database lease and the folder picker are process
concerns: they live in `@nightshift/daemon` (`src/runtime/`).

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
                           20261016155422_langgraph_checkpoints). A put
                           keeps only the latest checkpoint of its
                           namespace; pruneThread also drops the
                           namespaces LangGraph never enters again.
  graph/compile.ts         compileFlow(flow, ctx): StateGraph. START →
                           flow.start; every flow node, made by its kind's
                           factory, plus its park node park__<id> and the
                           auxiliary nodes its kind asks for (a wait node
                           wait__<id>, or the Gate's ask node ask__<id>).
                           One loop over flow.nodes; no node type named.
                           No static edges.
  graph/node-kinds.ts      The registry (below): NODE_KINDS, one NodeKind
                           descriptor per node type, exported by the
                           kind's module; kindOf(node), kindOfType(type).
                           The NodeKind interface itself is in context.ts.
                           Only the runner and run start import it. A
                           graph node asks ctx.kindOf(node).
  graph/route.ts           route(): picks the edge with `nextEdge`, logs
                           EdgeTaken and returns `new Command({ update,
                           goto })`; or ends the flow (the kind's
                           isChosenEnd and endReason); or parks
                           (parkCommand). parkNode, the node ids, scopeOf.
  graph/context.ts         StepContext (below, with kindOf: the registry,
                           given by the runner), NodeKind (the descriptor a
                           node module gives back, with PLAIN_KIND, the
                           facts most kinds share), the recorders, the
                           template context, stopAtOf.
  graph/step-runner.ts     The step runner (below): runStep() owns the step
                           lifecycle every node shares, from the resume
                           point to route(); beginStep/OpenStep is the lower
                           seam for the loop-shaped nodes (Call, Call with
                           `each`, the Gate).
  graph/run-position.ts    The run position (below): where a run is, as
                           the checkpoint and the log agree. commitVisit
                           (the one writer of visits), positionOf (the held
                           step, a loop mid-way, the uncommitted step, a
                           step that is done, the next visit), the front of
                           the walk, the re-entry seeds, a stale hold.
  graph/resume-point.ts    The one resume point (below): resumePoint()
                           decides how a node re-enters (new, continue,
                           reopen, done) from the run position, per kind
                           rules (RESUME_RULES); rerunEntryOf, sessionOf.
  graph/reentry.ts         The re-entry planner (below), the daemon side of
                           the same question: planReentry() says what
                           RunResumed records and how the thread moves for a
                           resume, a restart or a rerun, pure; with
                           resumeTarget and reentryUpdate.
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
  graph/nodes/agent.ts     agent node: the body runSession; AGENT, with
                           the Agent's requirements (CLI tools, harness)
                           and isOwnAgentLabel.
  graph/nodes/agent-ask.ts the ask node of an Agent that asks a person
                           (`ask`): answer reopens the step with the note,
                           stop ends it `fail`.
  graph/gate.ts            openGate: GateOpened, the transcript and the
                           bus, for a Gate and an Agent that asks.
  graph/nodes/command.ts   command node: the body runShell; COMMAND.
  graph/nodes/decision.ts  decision node: routes on the step; a chooser
                           per `by` gets the option. DECISION, whose
                           facts follow `by`.
  graph/nodes/choosers/    chooser.ts (the Chooser seam and the outputs
                           every chooser shares), person.ts (the Gate: the
                           node opens it, its ask node interrupts),
                           rule.ts (JSONata rules),
                           model.ts (the decider).
  graph/nodes/call.ts      the Call node: runs its flow once, or hands
                           over to call-each.ts; CALL, whose facts follow
                           `each`.
  graph/nodes/call-each.ts the per-element loop of a Call with `each`
                           (one element per super-step)
  graph/nodes/body.ts      What a Call does once and per element: bodyGraph,
                           runBody (a called flow as a subgraph of the node),
                           BodyEnd (how the body ended) and hasStoppedEdge.
  graph/nodes/value.ts     value node, the Decision's twin: routes on the
                           step; a producer per `by` makes the data, which
                           is checked against the output schema. VALUE.
  graph/nodes/producers/   producer.ts (the Producer seam and the ends of a
                           step every producer shares), rule.ts (one
                           JSONata expression), model.ts (the decider's
                           text adapter, `chat()` with the schema; waits
                           like a model Decision).
  graph/nodes/wait.ts      Wait node: works out the wake time (a duration,
                           a time, a command poll, a signal) and asks the
                           sleep module to sleep; a wake ends it done or
                           timeout, or sleeps again. WAIT.
  graph/nodes/tool.ts      tool node: one tools/call on a Connection's MCP
                           server through the step's Device
                           (Device.callTool), the Connection resolved as
                           for an Agent node. No wait node: a transport
                           failure is `fail`. TOOL.
  graph/each.ts            the pure parts of a Call with `each`: list items
                           from a source, item facts, the step's outputs
  graph/inputs.ts          a flow's input values, a Call's bindings, outputs
  graph/output-schema.ts   the output schema check (ajv)
  graph/policy.ts          the run policy's wait plan (planWait), pure
  graph/consume.ts         reads a harness stream, gives up after a grace
  graph/open-work.ts       Open work that is cut short (below): openWork
                           (what a stop, a missed deadline or a daemon
                           death ends), closingEvents (the pure list of
                           SessionEnded, StepEnded and RunEnded events,
                           inside out, with each kind's cutShortOutputs)
                           and closeOpenWork (appends them, tells the bus).
  graph/thread.ts          One Run's Thread: openThread() builds the one
                           StepContext, the fenced log and checkpoint saver,
                           and compiles the flow; driveGraph() is the one
                           stream loop (root interrupts only, no recursion
                           limit); endingOf() says what RunEnded a drive's
                           outcome asks for; inputOf() builds the LangGraph
                           input of a start, continue, resume or jump.
  graph/runner.ts          Per-run driver behind one entry: take(runId,
                           intent) is a Turn (start, answer, wake, resume,
                           restart, rerun, stop, overdue) and hold(runId,
                           fn) a Turn that drives nothing. It owns the
                           per-run queue, the slots, the run cap and its
                           queue, the drive, the wake timers and the
                           overdue sweep; it appends RunResumed (from
                           planReentry) and WaitEnded (recordWake) before a
                           drive, ends open work through closeOpenWork,
                           reacts to how a drive ended, and prunes an ended
                           run's thread to what a re-entry reads (also a
                           run a dead daemon left: the prune Turn of
                           startup recovery). A stop ends every run that
                           is going, also one that no drive holds.
  testing/graph.ts         The one set of graph test helpers: node builders
                           (agent(), command(), edge(), flowOf()), startRun()
                           for a run row with its log and its Thread (opened
                           as the runner opens it, on the sqlite saver), and
                           drive(), which runs the runner's stream loop and
                           collects the root's interrupts and custom events.
  run/engine.ts            The composition root: createEngine makes the
                           runner, recovery, run start, the read model, the
                           scheduler, the peers (EngineOptions.peers) and
                           the run actions, each behind a small seam that takes its
                           dependencies (db, log, runner, bus, settings,
                           clock), and wires them. It holds no logic.
  run/space.ts             createSpaces(deps): the SpaceEngine of one
                           Space. Each method waits for the engine and
                           hands over to the module that owns the action.
  run/actions.ts           The run actions behind one entry, act(spaceId,
                           actor, runId, request): stop, answer a Gate,
                           send a Signal, move, resume, restart a step, run
                           again. It reads the run's row once (its Space,
                           its Walker), refuses by the run's one rule
                           (run-status/, RunRefusal), and takes the action
                           as a Turn of the runner (take, or hold for a
                           stop after the step and a move), or hands it to
                           the Walker as a command (relay.ts): a stop, an
                           answer, a signal and a move travel, the rest
                           only the Walker takes. moveTargets lists the
                           Devices a move may go to.
  run/take-over.ts,        takeOver: the other end of a move. wake.ts: the
  wake.ts                  runs that slept for a Device that is back look
                           again.
  run/run-start.ts         Run start. prepareRun loads and validates the
                           flow and its called flows, resolves profiles and
                           asks every requirement in REQUIREMENTS (the
                           shared connections check, then each kind's own
                           from its descriptor: CLI tools defined and
                           installed, harnesses, the decider) whether this
                           daemon has what the nodes need; it writes
                           nothing. createRunStart(deps).start is the
                           start's Turn: with the slot held, it creates the
                           worktree and the run row, appends RunStarted and
                           WorktreeCreated, and the runner drives.
  run/recovery.ts          createRecovery(deps): startup recovery only.
                           recoverInterruptedWork (a dead daemon's open
                           sessions, steps and runs become interrupted
                           through closeOpenWork, as a stop ends them, and
                           a run that ends so is pruned; sleeping runs get
                           their timers back through runner.restore; after
                           a grace period the daemon resumes the rest
                           unless daemonResumeBlock says why not, queued on
                           a full run cap).
  read/read-model.ts       What people see of a run, from the log: runFacts,
                           toSummary, toStepSummary, toRunDetail,
                           takeOverCommand, the flow snapshot parsers;
                           createReadModel(deps) adds listRuns, getRun,
                           listGates, runStatus and watch.
                           Reads only.
  log/events.ts            Unchanged payloads, append and parse.
  read/derive-*.ts         The derivations for the read model and the walk.
                           Derivations only the old walk used are deleted.
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
   the derivations in `read/` and the web app keep working unchanged.
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
   from `deriveSleep` through `runner.restore` at startup). A wake is a
   Turn (`runner.take(runId, { kind: "wake", ... })`): `WaitEnded`, the
   transcript `wake`, then
   `Command({ resume: { kind: "wake", early, prompt } })`; the Agent node
   re-enters with `pending` and continues the session.
   A Wait node sleeps the same way with its own `until` (`graph/nodes/wait.ts`,
   below): its body returns `{ kind: "sleep" }` with the time and its
   deadline, the four kinds are `WaitReason`s next to the policy's two, a
   wait with no time (a signal with no timeout) has `until: null` and no
   timer, and a signal is `Command({ resume: { kind: "signal", name } })`
   through the same wake Turn (`Engine.signalRun`).
9. **Resume mapping** (`Engine.resumeRun`): stopped or failed → the thread
   is parked → `resume: { kind: "resume", prompt }`. Interrupted (daemon
   died) → the last checkpoint is before the node → `invoke(null)` re-runs
   it (rule 5). Sleeping → wake early. Stopped while at a Gate →
   `resume: { kind: "reopen" }` and the Gate asks again (it loops on
   `interrupt()` until it gets a choice). `RunResumed` is appended by the
   engine before any of these.
10. **Finish.** When the root stream ends with `state.ended.status ===
    "finished"`, the runner prunes the thread to its latest checkpoint
    (`Thread.prune`: the body namespaces go), then appends `RunEnded
    finished` with the reason the old walk used (`Ended at node "x" with
    "y".` for a non-`pass` chosen end). The prune comes first, so a person
    who resumes once the log says the run ended finds no drive holding
    it. Since 2026-10-25 every end prunes, and so does a run that parks
    at a wait or a Gate: a failed, stopped or parked run keeps its latest
    root checkpoint and the namespaces of the tasks that are not done, so
    a body that parked, waits or was cut short inside a Call goes on in
    its own namespace. The saver itself keeps only the latest checkpoint
    of each namespace, and drops the namespaces below an older one, at
    every put. An interrupted run (the daemon died) prunes when
    its next drive ends. The history was the walk's bookkeeping and the event
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
    itself under the same policy as before, now by `invoke(null)`. How the
    steps end deviates (below: "Recovery ends work as a stop does").
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
  (`graph/output-schema.ts`), `pass` with the data, or `fail` with why in `note`.
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
  `Command({ goto, update })`** (`planReentry`, the runner's re-entry Turn). A finished run (rule
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
- **Recovery ends work as a stop does** (`graph/open-work.ts`, 2026-10-22).
  Rules 3 and 12 kept recovery's own `StepEnded` events: the raw outputs,
  outside in. Now every cut (a stop, a missed deadline, a daemon death)
  appends the events `closingEvents` gives, so two things changed for an
  interrupted step. Its outputs are its kind's (`cutShortOutputs` with
  `interrupted`): a Decision gets `note: ""`, a Call `ended: ""`, and a
  Call with `each` its item counts, summary and results, so a template or
  a rerun that reads `nodes.<id>.*` finds every field. And the steps end
  from the inside out: a step inside a Call before the Call. No reader
  depends on the order between steps. Recovery reads the run's whole log
  for this, since its lifecycle filter has no item events, and publishes
  on the bus. A step of a kind an old log has and the engine no longer
  knows (a `gate` step) keeps its outputs, and a run whose snapshot cannot
  be read ends its steps without their nodes, so no cut throws.
- **The runner publishes `status-changed` on step chunks**
  (`runner.onCustom`). The `step-started` and `step-ended` custom stream
  chunks (`RunEvent`) make the runner publish `{ kind: "status-changed" }`
  on the bus; transcript entries reach the bus from the recorder already.
- **`resolveGate` waits for the step to end** (`run/actions.ts`). It reserves a
  slot, resumes the thread with `{ kind: "gate", choice, note }` and
  returns once the log has the step's `StepEnded`, so the run no longer
  waits when the caller looks again. A full run cap leaves the Gate open.

## The run position (`graph/run-position.ts`)

One rule keeps the checkpoint and the event log in agreement. The
checkpoint counts the visits of each node it committed (`visits`). The log
counts every step the node started. When the log counts one more, the
node's latest step did not commit: a step that runs, a Gate that is open,
the step of a daemon that died, or a step a re-entry left uncommitted on
purpose. Before 2026-10-25 that rule was written in `route.ts`, `sleep.ts`
and `call-each.ts`, seeded in `reentry.ts` and read in `resume-point.ts`.
Now one module owns it, behind a small interface:

- `commitVisit(node, visit)`: the one writer of `visits`. A node commits
  when its step ended, when its step sleeps, and after each element of a
  Call with `each`. A Gate does not commit while it is open.
- `positionOf(state, events, scope)`: where the run is in one scope, for
  one node at a time. `held` (what a wait, a park or a Gate holds),
  `looping`, `latest`, `uncommitted`, `done`, `cursorBehind` and
  `nextVisit` (the visit a new step gets).
- `frontOf`, `latestFront`, `reenteredNode`: the front of the walk in the
  log, its last step and whether the walk moved on from it.
- `loggedVisits`, `takeBackVisit`: the visits a re-entry seeds, so that
  exactly the step it means is left uncommitted.
- `holdEnded`: a held wait or Gate whose step a stop ended in the log.

The log is at most one super-step ahead of the checkpoint. A crash test at
every write of one flow (`graph/crash.test.ts`: the daemon dies, or a person
stops the run, just before each log append, row and checkpoint write)
found four places where the two did not agree. Each is now a rule of the
run position:

1. **A step that ended before its commit is done.** The daemon died, a
   stop fenced the drive off or the engine failed between `StepEnded` and
   the commit. The node re-ran it: an Agent reopened its session, a
   Command ran again, a Gate asked again. Now `Position.done` finds a step
   the checkpoint holds open or never committed that ended on its own (not
   `stopped`, `error` or `interrupted`), and the node goes on from its
   logged end (`routeDone`): the same update, and the `EdgeTaken` the log
   has, taken in the state only. The one exception is the last step of a
   run that finished: a resume reopens it on purpose (rule 10).
2. **A task whose writes are saved keeps the thread pending.** LangGraph's
   `next` leaves out a task whose writes are saved before its super-step
   was checkpointed. The planner read that thread as ended and jumped, and
   LangGraph refused two writes to `pending` in one step. `ThreadState`
   now says `pending`, and `invoke(null)` applies the writes and goes on.
3. **A loop's cursor catches up.** An element of a Call with `each` ended
   and the commit after it never landed. The re-run started the next
   element in the same task, so in the namespace of the body that had
   ended, which returned at once. Now the node commits the cursor first
   (`cursorBehind`), and the next element gets a super-step of its own.
4. **A stale hold lets go.** A stop ended an open Gate or a sleep after the
   node held it and before the hold was checkpointed. The resume went on
   into the ask or wait node, which waited for an answer that no one could
   give. Now an interrupting node with no answer waiting lets a stale hold
   go (`interruptNode`'s `stale`): the Gate asks again in a new visit, a
   sleep parks as stopped.

The checkpoint is still the walk's and the log still the read model (ADR
"The walk reads the checkpoint; the event log is the read model"). The run
position is the one place where the two are compared.
`graph/run-position.test.ts` holds the rule as tables.

## Fan-out and join (`graph/branches.ts`, `graph/nodes/join.ts`)

Built 2026-10-26 (node review, `docs/research/node-review-2026-10.md`
§5.1). The earlier plan here made each branch a body, as a Call's is. The
flow file chose plain edges instead: two or more edges without a `max` on
one outcome are a fan-out, and every branch ends at the same Join node
(`wait: "all" | "first"`). `@nightshift/flows` reads the shape
(`fanOutsOf`, `branchPlaces`) and checks it (`validate/branches.ts`): one
Join per fan-out, branches that share no node, do not fan out again and
do not lead back, no edge into a branch or its Join from outside.

**In LangGraph.** The fan-out's `route()` returns one `Command` with every
branch's node in `goto`, so the branches run as tasks of one super-step.
Each branch moves on in the super-steps after, in step with the others:
a super-step ends when all its tasks did, so a branch's next step starts
when the steps of the other branches end. A Join runs whenever a branch
reaches it; it does nothing until its rule holds, then runs one step that
ends `done` with each branch's `data` keyed by the node it came from.

**What the state learned.**

1. `pending` is keyed by node (`Held`, reducer `holds`): each branch
   keeps its own wait, park or Gate, and `route()` releases only its own
   node. `heldOf` reads a checkpoint from before, which holds one
   `Pending` or null.
2. `joins` keeps one round per Join (`JoinRound`): the fan-out opens it,
   each branch that reaches the Join arrives in it, the Join's route
   closes it. A later round replaces an earlier one; writes to one round
   merge, so branches that arrive in one super-step all count.
3. A branch whose round is closed goes no further (`outrun`): its new
   steps do not start, and a step that ends routes nowhere.

**`first`.** A super-step waits for all its tasks, so the Join alone would
wait for the slowest branch. The branch that reaches a `first` Join first
claims the round in memory (`Races`, one per Thread) and aborts the steps
that run on the other branches (`AbortReason` `outrun`: they end
`stopped` with "Another branch reached the Join first."). After a
restart the claim is gone and the Join picks the earliest arrival from
the state.

**Interrupts.** A branch that parks, sleeps or opens a Gate interrupts
its own task. The other tasks of the super-step finish, and the walk
halts until a person or a wake answers: the other branches pause after
their running step. The thread can sit at several interrupts
(`ThreadState.interrupted.interrupts`). A resume answers each by its id
(`ThreadEntry.each`, `resumeEach`): every parked branch is resumed, a
Gate asks again, an answer or a wake goes to its own step only. A drive
that ends with a parked branch ends the run, even when another waits.
An answer to a Gate while another branch's step still runs is refused
with words for that. `RunResumed` names the parked branch's node
(`branchTarget`).

**Crash.** `crash.test.ts` walks a fan-out too, with a crash and a stop
before every write. A fan-out whose commit was lost goes on from the log
(`DoneStep.edges`: the `EdgeTaken` of each branch it took, appended once).

**Not built.** A branch that fans out again (a called flow can). One
copy of the project per branch: branches share the run's worktree, and
the checks warn about two Agents that can edit files. A Gate answered
while the other branches run (the "Turn" question): the answer is
refused until their steps end. Two branches may each hold a Gate or an
Agent's ask at once, and each answer goes to its own step. An Agent's ask
closes in the log when its step reopens, in the super-step after the
answer: while another branch still waits, the answered ask looks open.

## The resume point (`graph/resume-point.ts`)

One module answers one question for every node: how does the node
re-enter after a park, a wake, a resume or a daemon death? It is a deep
module behind a small interface. `resumePoint(node, state, events, scope,
rules)` returns `{ kind: "new" }`, `{ kind: "continue", step }`,
`{ kind: "reopen", step, prompt }` or `{ kind: "done", step }`.
`entryOf(point)` turns a point other than `done` into the `StepStart` for
`beginStep`; a step that is done begins nothing, and the node routes on it
(`routeDone`). The module appends nothing: it decides, and `beginStep`
writes the log as before (rule 3). Where the node is comes from the run
position.

The rule, in this order:

0. The step the checkpoint holds open or never committed ended on its own
   after the last commit (`Position.done`): `done`. The same for every
   kind.

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
   saw (`Position.uncommitted`, rule 5): taken up when the kind's
   `crashed` rule says so, else a new visit.
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

`graph/resume-point.test.ts` holds the rule as a table: one situation,
every kind.

## The re-entry planner (`graph/reentry.ts`)

The daemon side of the same question: a person or the daemon asks a run
that is not going to resume, to restart its running step, or to run again
from a node. `planReentry({ flow, events, thread, request, now })` is pure.
From the log and the thread's latest checkpoint (`ThreadSnapshot`) it
gives one plan: the `RunResumed` payload, the thread entry (`ThreadEntry`:
answer the interrupt, run the pending node again, or jump to a node) and
whether the leftover task is cleared first. It throws the refusals with a
message for the person: a run that runs, waits or sleeps, a node that is
not a top-level node of the run's flow, a step that is not that node's.

The runner's re-entry Turn (`reenter` in `runner.ts`) is the one place
that appends `RunResumed`: with the run's slot held, it plans, appends,
and drives the entry. A thread that cannot move ends the run `failed`
("The run could not start again: ..."), so the log never says a run runs
that no drive holds.

The planner reads the node side's helpers: `resumeTarget` (the node, and
the Agent step whose harness session the resume continues, `sessionOf`;
none for a step that is done) and `reentryUpdate` (the seed state of a
thread with no checkpoint). Where the run is comes from the run position:
`reenteredNode` (the last top-level step the walk did not move on from),
`takeBackVisit` (a finished run's last visit) and `loggedVisits` (a
rerun's visits). Because one call gives both the
payload and the entry, the engine promises in `RunResumed` what the node
finds when it re-enters. `graph/reentry.test.ts` holds the plans as a
table, and its promise rows apply each plan and ask the resume point
(`resumePoint`, `rerunEntryOf`) what the node then does.

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
module writes a database row. A row and the event that names it are one
write of the drive (`StepContext.write`, `graph/fence.ts`): a stop lands
before both or after both, so it never leaves a `step` or `agent_session`
row without its event.

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
2. Plans the wait. A policy wait goes through `planWait` (`graph/policy.ts`,
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

The daemon side is the runner's wake Turn over three parts of this module.
`planWake(events, threadState, how, now)` (pure) checks that the run still
sleeps in the log and that the wait is the interrupt the thread sits at,
says when a timer fired before its time, and gives the resume value
(`{ kind: "wake" }` or `{ kind: "signal" }`). `recordWake` appends
`WaitEnded` and the transcript `wake` once the run holds a slot.
`createSleeps(deps)`, one per runner, holds the timers: `schedule(runId,
until)` sets one, and a timer that fires hands the run to the runner's
wake Turn; `restore(runId, events)` sets it from `deriveSleep` for a run
that slept when the last daemon died (the log stays the restart source);
`forget(runId)` drops it (the runner calls it before `closeOpenWork`). A
full run cap queues a timer's wake in the runner's cap queue and refuses a
person's.

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

## The node-kind descriptor (`graph/node-kinds.ts`)

One module per node kind says what the engine must know about that kind.
Each node module exports one `NodeKind<N>` next to its factory (`AGENT`,
`COMMAND`, `TOOL`, `DECISION`, `VALUE`, `WAIT`, `CALL`); `NODE_KINDS` lists
them by type, and `kindOf(node)` or `kindOfType(type)` gives a caller the
descriptor. The interface is in `context.ts`, next to `StepContext`: what
a node factory gets, and what a node module gives back. `PLAIN_KIND` holds
the facts most kinds share; a kind spreads it and overrides what differs.

Before the descriptor, a kind's facts were a switch spread over the engine.
Adding the Tool node touched 16 files in 4 packages; adding the Wait node
touched `state.ts`, `route.ts`, `context.ts` and `runner.ts` on top of its
own module. Now the engine asks the descriptor:

| Member | Who asks | What it replaced |
| --- | --- | --- |
| `make` | `compile.ts` | the `switch (node.type)` that picked the factory |
| `aux(node)` | `compile.ts` | the same switch deciding wait and ask nodes, per `by` |
| `resumeRules(node)` | the kind's own factory | the `RESUME_RULES` entry each factory named |
| `isChosenEnd(node, outcome)` | `route()` | `isChosenEnd`, `isOwnAgentLabel`, `isSuccessExit` in route.ts |
| `endReason(node, outcome)` | `route()` | `finishedReason` in route.ts |
| `endedLabel(node, outcome)` | the Call node | `endedLabel` in body.ts |
| `logsCommandOutput(node)` | `beginStep` | the three-kind `logPath` rule |
| `timeBudget(node)` | `beginStep`, `abortEnd` | the Gate and Wait timeout rule, the Agent idle rule |
| `cutShortOutputs(open, node, outcome)` | `closingEvents` (`graph/open-work.ts`) | the `nodeType` ternary of the stop, and recovery's raw outputs |
| `connections(node)` | `run-start.connectionsExist` | the Agent-or-Tool branch |
| `requirements` | `run-start.REQUIREMENTS` | the per-kind requirement functions |

The deletion test picked the members: a fact is on the descriptor only
when deleting the switch in a caller would make the fact reappear there.
A fact may depend on `node.by` (Decision, Value) or `node.each` (Call);
the chooser and producer seams stay as they are. Not on the descriptor, on
purpose: the zod union in `packages/flows` and the web's `NODE_TYPE` record
(inherent, outside this package); the transcript-event unions in `log/step-events.ts`
(typed data, no switch asks them); the `WaitReason` enum in `state.ts` (a
Wait node's `until` kinds and the policy's reasons, not node kinds); which
flow a Call calls (`flows/run-flows.ts`, `open-work.nodesOf`: only a Call does,
both read `node.flow`); the first Agent prompt a quick run is titled by;
and the resume target's "an Agent step with a harness session".

The registry imports the node modules, and no module a node imports
imports the registry. The runner puts `kindOf` on the `StepContext`, so
`compile.ts`, `route.ts`, the step runner and the Call node ask
`ctx.kindOf(node)`. The chooser and producer seams have a leaf of their own
(`choosers/chooser.ts`, `producers/producer.ts`), so a chooser does not
import the Decision node that picks it. `graph/` has no import cycle, and
Biome's `noImportCycles` holds it there too. `graph/node-kinds.test.ts`
holds every fact for every kind as a table.

### How to add a node kind

1. `packages/flows/src/nodes/<kind>.ts`: the node schema, its checks and
   its output fields. Add it to the `flowNodeSchema` union and the
   per-type switches in `packages/flows/src/flow/`, and its check to
   `packages/flows/src/validate/nodes.ts`. Bump the flow version when old
   flows must migrate.
2. `packages/engine/src/graph/nodes/<kind>.ts`: the factory (`runStep` with
   a body, or the lower seam `beginStep` for a loop-shaped node) and the
   descriptor: `{ ...PLAIN_KIND, type, make, resumeRules, ... }`, overriding
   only the facts that differ. A new way to re-enter is a new `RESUME_RULES`
   entry in `resume-point.ts`.
3. `packages/engine/src/graph/node-kinds.ts`: one entry in `NODE_KINDS`.
   The type of the registry refuses a missing kind.
4. `packages/engine/src/log/step-events.ts`: the kind's transcript events, when it
   records any.
5. `packages/engine/src/graph/node-kinds.test.ts`: the kind's row in every
   table; a node test next to the others (`<kind>-node.test.ts`), shaped
   as the next section says.
6. `apps/web`: the `NODE_TYPE` record, the inspector form, the canvas node.
7. Check that nothing else names the kind. From `packages/engine/src`:
   `grep -rn -E 'node\.type ===|nodeType ===|case "<kind>"' --include='*.ts' . | grep -v '\.test\.ts'`
   must show the kind in its own module only.

## Test shape

The interface is the test surface, and a shared rule is tested once, at
the module that owns it. `graph/step-runner.test.ts`, `graph/sleep.test.ts`,
`graph/resume-point.test.ts` and `graph/node-kinds.test.ts` hold the shared
rules as tables: the entry checks, the stop time, the step cap, the time
budget, an abort, a wait and its wake, how every kind re-enters. A per-kind
test (`<kind>-node.test.ts`) covers what only that kind decides, its
outcomes and payloads (the log, the transcript, the state, the error
messages), plus one end-to-end path through a wait and one through a crash
re-entry on the compiled graph, so the integration of body, runner, sleep
and resume point stays covered for each kind. A scenario that re-tests a
shared rule belongs in that module's table, as a row, not in a node test.
The public seam keeps its own tests: `engine.test.ts`, `flows-v2.test.ts`
and `call-each.test.ts` go through `createEngine`.

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
  deviceFor(node, run): Device;      // the step's Device; the runner asks once per step
  signal(): AbortSignal;             // the run's abort signal
  now(): number; minuteMs: number;
  dataDir: string;
  settings(): RunSettings;
};
```

A node factory is `(node, ctx) => (state, config) => Promise<Command>`.
Only the step runner reads `db`: it writes the `step` and `agent_session`
rows. The node modules read the rest. A body touches a computer only
through `step.device` (`device/types.ts`): sessions, commands, tool calls,
the decider.
