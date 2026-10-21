# Review: the run engine on LangGraph (branch `spike/langgraph`)

Worktree: `/private/tmp/claude-502/-Users-sander-personal-nightshift/6053c363-339a-476a-97eb-9c292ccc19cb/scratchpad/spike-langgraph`.
Paths below are relative to `packages/engine/src/` unless they start with `packages/` or `docs/`.
Every finding was verified by reading the code paths named; the ones marked **probe** were also
reproduced with `scratchpad/research/review-probe.ts` (run from `packages/engine` with `bun run`;
output in `review-probe.out`). The probe drives the compiled graph on a MemorySaver through
`graph/node-test-support.ts`, exactly as the node tests do.

## Blockers

### B1. The runner never sets `recursionLimit`: any drive with more than 25 super-steps fails — probe

`graph/runner.ts:286-291` streams with `streamMode`, `subgraphs`, `durability` and nothing else, so
LangGraph's default `recursionLimit` of 25 applies to every drive. Every node visit is one
super-step, each park/wait node is another, and a For Each spends one super-step per element
(`graph/nodes/foreach.ts:188-205`, `goto: node.id`). Nothing in `src/` or the docs mentions the
limit; the tests never exceed ~10 super-steps.

What breaks: a For Each over 24+ elements, or any flow whose nodes are visited more than ~24
times in one drive (retry edges with `max: 10` on three nodes, a planner → worker loop). The
graph throws `GraphRecursionError: Recursion limit of 25 reached`, `driveThread` catches it and
appends `RunEnded failed` with `The engine failed: Recursion limit of 25 reached…`. A resume
re-enters and the count starts at 0 again, so it fails again 25 super-steps later. Verified: the
probe's 50-element loop (json source, one-node body) died at element ~24 with exactly that error;
with `recursionLimit: 1000` it finished.

Smallest fix: in `driveThread`, pass `recursionLimit: Number.MAX_SAFE_INTEGER` (the step cap is
already enforced per walk by `beginStep` from the log, `graph/context.ts:399-405`; a numeric
guess such as `maxStepsPerRun * 4` would still fail long For Each bodies). Subgraphs inherit it
through the config passed to `runBody`. Add a test with a 30-element For Each, or a self-loop
edge with `max: 30`.

## Should-fix

### S1. `beginStep` parks a *continued* or *reopened* step without ending it — probe (regression)

`graph/context.ts:386`: `if (ctx.signal().aborted) return parked("stopped", null)` runs for every
`StepStart`, including `continue` and `reopen`. `parkCommand` then stores `pending.stepId: null`,
the park node interrupts, and the runner only appends `RunEnded stopped`
(`graph/runner.ts:348-351`); nothing ever appends `StepEnded` for the step that was being
continued.

Scenario: a sleeping run's wake timer fires (`wake()` appends `WaitEnded`, the transcript `wake`,
then `drive()` and releases the per-run lock); a person presses Stop in the few ms before the
Agent node's entry (one checkpoint read + `log.events`). `stop()` aborts the controller;
`beginStep` sees it and parks. Probe result: step visit 1 stays open forever (`endedAt: null`),
`pending = { stepId: null, harnessSessionId: null, visit: 0 }`, the log ends
`… WaitStarted WaitEnded RunEnded(stopped)`; the web app shows the step as running under a
stopped run; the next daemon start ends it `interrupted`. The person's resume then goes
`park → worker` as a **new visit**: `harness.calls[1].resumeSessionId === undefined`, so the
harness session is lost, and the person's resume prompt is dropped (`entryOf` skips the stale-step
reopen because `pending` is non-null, `graph/nodes/agent.ts:247`). The same path exists for a
parked Agent step resumed with a prompt (`reopen`), for the Decision wait, and for For Each /
Subflow `continue`/`reopen` entries; the Gate's `resolve` (`graph/nodes/gate.ts:200-206`) cannot
hit it in practice because `resolveGate` holds the per-run lock until the step ends, but its
comment ("the runner then closes the open Gate as `closeParked` does today") is wrong: the runner
does not call `closeParked` on a `parked` interrupt.

The old walk had no entry abort check for a continued step (`git show HEAD:…engine.ts`, `runStep`
at 1021-1090): the harness got the aborted signal and the step ended `stopped` with its session.

Smallest fix: apply the `ctx.signal().aborted` early return only when `start.kind === "new"`.
A continued or reopened step then enters the node body, where `runSession` throws at once on an
aborted signal (`agent.ts:471`), `SessionStarted`/`SessionEnded stopped` are logged,
`step.abortResult` ends the step `stopped` with `harnessSessionId`, and `route()` parks with the
step, so a later resume reopens it. Fix the gate.ts comment at 204-205.

### S2. A run from the old engine (no checkpoint) is re-entered with empty `visits`/`nodes`/`traversals`

`engine.ts:591-594` → `runner.reenter` (`graph/runner.ts:563-574`) jumps to `topNodeId` with
`update: { inputs, ended: null, pending: null }` and nothing else. Every node then decides how to
enter from `uncommittedStep` (`graph/context.ts:287-300`: log visits > `state.visits[node]`), and
with `state.visits = {}` **every** node that has a step in the log looks uncommitted:

- the Agent node at the target reopens its last step — fine;
- every later Subflow / For Each node (`subflow.ts:148`, `foreach.ts:440` via `continueStep`)
  **reopens a step that ended `pass`/`done`**: `StepReopened` + a second `StepEnded` on a finished
  step id, `visit = existing.visit` reused, the Subflow reruns its body with the old
  `FlowCalled` inputs; a Gate later in the flow opens visit `countVisits+1` (fine), a Command
  starts a new visit (fine);
- `state.nodes` is empty, so `{{nodes.x.output}}` in prompts renders empty; `state.traversals`
  is empty, so edge `max` counts restart.

Scenario: the daemon is upgraded with a run mid-step, or a person resumes any stopped/failed
run started before the upgrade. `recoverInterruptedWork` marks it interrupted and
`resumeAfterRestart` auto-resumes it (up to three times) — no person needed to trigger it.
`docs/PLAN.md` says no night has run on the new engine yet, so every existing database has such
runs.

Smallest fix: in `resume()`'s `fresh` case, seed the update from the log for the top level:
`visits` = `countVisits(events, id, "")` per flow node, `nodes` = `deriveNodeOutputs(events, "")`,
`traversals` = `deriveTraversals(events)` (bodies get fresh namespaces anyway). Alternatively make
`daemonResumeBlock` refuse a `fresh` thread whose log has steps ("this run began on the previous
engine; resume it yourself") and only seed on a person's resume. Add a test that builds an
old-engine-shaped log (agent pass → subflow pass → agent stopped) and resumes it.

### S3. Checkpoint growth: `loops` and `steps` are write-only state, and threads are never pruned — probe

- `RunState.steps` (`graph/state.ts:125-131`) is appended in `route.ts:138-147` and
  `foreach.ts:153-162` and read nowhere.
- `Loop` (`state.ts:107-112`): `state.loops[node.id]` is only tested for truthiness
  (`foreach.ts:437`); `loop.results` is only appended (`foreach.ts:195`); `loop.items` and
  `loop.index` are never read — the node re-reads the source each element and takes the open
  element from the log (`step.existing.items`, `foreach.ts:220-232`). Design rule 13 ("The cursor
  and item states live in `state.loops`") describes something the code does not do.
- Nothing calls `LibsqlSaver.deleteThread`; a finished run keeps every checkpoint and pending
  write forever.

Measured (probe, MemorySaver so bytes equal what libsql would store; 50-element json source with
title/url/short body, one-node body, each Agent step ~4 KB of outputs = 2 KB `output` + 2 KB
`summary`): 203 checkpoints in 51 namespaces, **1.6 MB of checkpoints + 1.5 MB of pending
writes ≈ 3.2 MB for one run**. The root's 53 checkpoints are 24–28 KB each (1.3 MB in total),
almost entirely `loops.items` (the 50-item list ≈ 23 KB, plus `results` growing per element);
the final root `nodes` is 6 KB and `steps` 126 B. Per element: ~25 KB root + ~7 KB body + the
same again in `lg_write`. A GitHub source stores each issue's whole `value` in the list, so real
loops are larger; a Subflow or For Each nested in a body multiplies it. 10 / 25 / 50 elements
took 4.0 / 10.4 / 20.4 s on the fake harness — linear, so the cost is DB writes per event, not
the state size, but the table grows without bound.

What should move out of state: `Loop.items` and `Loop.results` (the log has both), `steps`
(the log has it). Keep `nodes` (templates need it) and `visits`/`traversals`/`pending`
(small). Smallest fix: `Loop = { index: number }` or a plain `true` marker, delete the `steps`
channel. Follow-up: on `RunEnded finished` (and on project removal) delete all but the latest
checkpoint per namespace, or the whole thread, through the saver.

### S4. A Decision (or session-less Agent) step continued after a wait + daemon death gets a second `StepEnded` that the read model ignores

`graph/nodes/decision.ts:136-142` returns `{ kind: "continue" }` whenever `pending.kind ===
"wait"`, and `beginStep` with `continue` appends nothing (`context.ts:435-449`). If recovery
ended that step (`StepEnded interrupted`, engine.ts:281-292) because the daemon died while the
decider ran after the wake, the node's own `StepEnded` is the step's second one, which
`deriveSteps` drops (`events.ts:764`, `StepEnded && step.endedAt === null`). The run takes the
label's edge, but the UI keeps `outcome: interrupted` for the step and the decider's `costUsd`
is lost. The Agent node handles this case (`agent.ts:225-228`) only when the step has a harness
session id; a limit hit before the `session` event falls through to `continue` too
(`agent.ts:229-234`).

Smallest fix: in both `entryOf`s, when the pending step's `endedAt !== null`, return
`{ kind: "reopen", stepId, prompt: null }` (what `continueStep` in `body.ts:175-181` already does
for Subflow/For Each).

### S5. Body `StepContext` copies keep a stale `policy`

`bodyGraph` (`graph/nodes/body.ts:62-68`) spreads `ctx` once and the compiled body is cached in
the node closure (`foreach.ts:366`, `subflow.ts:98`); `threadOf` refreshes only
`cached.ctx.policy` on the root context (`runner.ts:160-166`). After a settings change
(`usageLimitFirstWaitMinutes`, `usageLimitMaxWaitMinutes`, `networkGraceMinutes`, policy
`maxSteps`) a thread that stays cached (a run at a Gate for days, a sleeping run) plans waits and
checks the step cap with the new numbers at the top level and the old ones inside bodies.

Smallest fix: make it `policy(): ResolvedPolicy` on `StepContext`, resolved at use like
`settings()`; or drop the refresh and `threads.delete(runId)` whenever a drive ends.

## Nits

### N1. A run that reached END but has no `RunEnded` is re-run from its last node
`engine.ts:591-594`: if the daemon dies between the last checkpoint and `endRun("finished")`
(`runner.ts:315-316`), recovery marks the run interrupted and auto-resume calls `reenter` at the
last step's node, so the last Agent step runs again (new visit). Fix: when
`thread.kind === "ended" && thread.ended`, append `RunEnded finished` with `ended.reason` instead.
Related: the API still accepts `resumeRun` on a `finished` run (the old engine did too), but now
it is a new visit with the node's prompt instead of continuing the last session with the person's
prompt; the web app never offers it. Either refuse `finished` in `resume()` or note the change.

### N2. The Agent's wait-branch reopen drops the daemon's resume prompt
`graph/nodes/agent.ts:225-228` reopens with `pending.prompt` (the wake's "Continue where you left
off.") rather than the `RunResumed` prompt, so after a daemon death during a continued session
the "check git status before you repeat anything" prompt (`engine.ts:102`) is lost. Fix:
`resumePromptOf(events, own) ?? pending.prompt`.

### N3. Dead code, duplication, stale comments
- `RunState.steps` and most of `Loop` (see S3).
- `graph/compile.ts:30-41` re-exports `finishedReason, isChosenEnd, parkCommand, parkNode,
  parkNodeId, route, StepEnd, scopeOf, waitNodeId, NodeAction, NodeFactory`; every importer of
  `compile` takes only `compileFlow`.
- `templateContext` (`context.ts:255`) and `MAX_TIMER_MS` (`runner.ts:72`) are exported but used
  only in their own file.
- Duplicates: `isOwnAgentLabel` (`route.ts:48`, `body.ts:151`); `isWaitKind` (`agent.ts:310`,
  `decision.ts:144`); `HARNESS_LABEL` (`engine.ts:123`, `agent.ts:274`); `getRunRow`
  (`engine.ts:386`, `runner.ts:200`).
- `events.ts`: `deriveRunStatus`, `withEnclosing`, `deriveSessions` are exported but used only
  inside `events.ts`.
- `gate.ts:183-188` TODO about `beginStep({ kind: "continue" })` emitting `step-started
  { reopened: true }` before the Gate ends — harmless (the bus item is `step-changed`) but
  should be closed or tracked.
- Comments that contradict the code: `gate.ts:204-205` (see S1); `state.ts:121` says the graph's
  `visits` lag the log by the running step, but the Agent node commits `visits` while its step
  still waits (`agent.ts:104-110`) and the For Each while its step is open (`foreach.ts:200`);
  `route.ts:24-25` and `compile.ts:18-19` say only Agent nodes have a wait node — Decision has one
  too (`compile.ts:63-69`).
- `docs/steering/langgraph-engine.md`: rule 13's "cursor and item states live in `state.loops`"
  (see S3); the `StepContext` block omits `db` and `flowName` that the code has; rule 11 should say
  subgraphs inherit `durability` through `__pregel_durability` (they do, verified in
  `pregel/loop.js`). `docs/research/langgraph-probe.md` points at the deleted
  `packages/engine-langgraph/src/probe/` (its header says so; fine).

### N4. Checkpointer (`graph/checkpointer.ts`) — small things only
- `put` and the following `putWrites` are separate statements, as in the upstream sqlite saver;
  LangGraph tolerates a checkpoint without its writes, so no transaction is needed.
- `putWrites` mirrors upstream (`OR REPLACE` for all-special channels, else `OR IGNORE`,
  `idx` from `WRITES_IDX_MAP`), and `sortWrites` orders by `writesSortKey` on read — correct.
- `list`: `before` uses `checkpoint_id < ?` and `getTuple` uses `ORDER BY checkpoint_id DESC`,
  which relies on UUIDv6 ids sorting by time — the same assumption upstream makes. `filter`
  compares `CAST(metadata AS TEXT) -> '$.key'` with `JSON.stringify(value)`, fine for scalars
  (the test covers `step`); an object value would need `json(?)` on the right. `limit` goes through
  `Number()` — safe.
- `toTuple` casts `pw.value` to TEXT inside `json_group_array`; fine while the serde only ever
  produces `json`, which it does here. `blob()` throws on an unexpected driver shape — good.
- No caller of `deleteThread` (S3).

## Checked and found correct (so the caller need not re-verify)

- Nested resume: `invoke(null)` and `Command({ resume })` at the root set
  `configurable.__pregel_resuming` for every task (`pregel/loop.js:941`), so a body invoked with
  a fresh `{ inputs }` under the same task id resumes at its own pending node instead of
  restarting from its start; `uncommittedStep` then continues the open step. The For Each /
  Subflow "daemon death inside the body" tests exercise exactly this.
- Event order on the resume paths (`RunResumed` before the thread moves; `WaitEnded` + transcript
  `wake` before the wake; `StepReopened` before a new session) matches the old engine's.
- `RunEnded` is written once per walk: `onInterrupt` only for `parked`, `closeParked` for a stop
  that lands while a wait/Gate began (same as the old `paused` branch), the catch for engine
  failures; `stop()` after `slot.done` sees `stopped` and returns.
- `status-changed` for `watchRun`: published by `drive()` at start, by `onCustom` on every
  `step-started`/`step-ended` chunk (so a Gate answer flips `waiting → running` without waiting
  for the drive to end), and in `.finally`.
- Two drives of one run: every `drive()` caller reserves a slot first; `wake`, `stop`,
  `resolveGate` serialize on `exclusive`; a full cap queues non-early wakes and daemon resumes,
  and both drain on `onSlotFreed`.
- Dispose: timers cleared, `pendingWakes`/`pendingResumes` cleared, `scheduleWake` no-ops after
  dispose; a running drive is left to finish, as before.
- Scopes: `configurable.scope` is set by `runBody` and overridden by nested bodies; body nodes
  stamp it on `StepStarted`/`EdgeTaken`; body `traversals` are per body invocation (per element),
  as the API comment says.
- Security: `renderCommand` turns every `{{ref}}` into `${NS_…}` with the value in `env`
  (`packages/flows/src/template/template.ts:97-137`), `runCommand` spawns `sh -c` with that `env`
  (`command.ts:88-93`), for the Command node and the For Each command source alike — values never
  become shell text. `fileItems` refuses absolute, `~` and `..` globs; the GitHub parent is parsed
  as a positive integer; JSON sources go through `normalizeList` (array, unique ids);
  transcript/log paths are `join(dataDir, …, <engine uuid>)` and a reopened step's path comes
  from the engine-written log; `takeOverCommand` is still shell-quoted.
