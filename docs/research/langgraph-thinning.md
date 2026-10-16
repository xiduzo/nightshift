# Thinning the run engine on LangGraph: what we probed and what we changed

**Date:** 2026-10-17. **Branch:** `arch/thin-walk`. **LangGraph:** `@langchain/langgraph` 1.5.0,
read from the installed package (`$LG` = `node_modules/.bun/@langchain+langgraph@1.5.0+*/node_modules/@langchain/langgraph/dist`).
**Design doc:** `docs/steering/langgraph-engine.md`. **Earlier probes:** `docs/research/langgraph-probe.md`.

Two candidates from the engine review asked whether more of the walk could be LangGraph's:

- **Candidate 3:** let LangGraph own step timing, the stop and the waits (`TimeoutPolicy`,
  `RunControl`, `retryPolicy`, `recursionLimit`).
- **Candidate 4:** let the walk read only the Checkpoint, and keep the Event Log as the read
  model for people.

We read the installed code first. The verdicts below are decided; do not probe them again.

## What we found in LangGraph 1.5.0

1. **A node timeout drops the node's writes and leaves it running.** `runAttemptWithTimeout`
   (`$LG/pregel/timeout.js`) races the node against a watchdog. When it fires, LangGraph discards
   the node's buffered writes, aborts the composed signal and throws `NodeTimeoutError
   { node, kind: "run" | "idle", timeout, elapsed }`. The node's promise keeps running. Its
   `step.end()` still appends `StepEnded` later, and its returned `Command` is lost.
2. **The API.** `addNode(name, fn, { timeout?: number | TimeoutPolicy })`
   (`$LG/graph/state.d.ts`, `NodePolicyOptions`). `TimeoutPolicy = { runTimeout?, idleTimeout?,
   refreshOn?: "auto" | "heartbeat" }` (`$LG/pregel/utils/timeout.d.ts`). A node gets
   `config.heartbeat?.()`, `config.signal` and `config.control`
   (`$LG/pregel/runnable_types.d.ts`). `heartbeat` exists only when a timeout is set.
3. **`interrupt()` throws at once.** The attempt ends and its timers clear, so a timeout never
   fires while a run is parked. Each resume is a new attempt with a fresh timer. A timeout inside a
   Subflow or For Each body reaches `runBody` as a plain error and fails the whole drive.
4. **A `signal` passed to `stream()` kills the drive.** `_executeTasksWithRetry` rejects at once
   with `Error("Abort")`. The graceful "end the step `stopped`, return the park Command" is lost.
   The runner's own `AbortController` and `STOP_GRACE_MS` must stay.
5. **`RunControl.requestDrain` is not persisted.** `requestDrain(reason?)`, `drainRequested`,
   `drainReason` (`$LG/pregel/runtime.d.ts`), passed as `stream(input, { control })`. The drain
   check runs after the checkpoint save (`$LG/pregel/loop.js:697`) and throws `GraphDrained`.
   It never cancels a running node, propagates into bodies, and a drained thread looks like a
   crashed one to `threadState`.
6. **`retryPolicy` retries in-process.** `{ initialInterval = 500, backoffFactor = 2,
   maxInterval = 128000, maxAttempts = 3, jitter, retryOn?, logWarning }` re-invokes the node
   from the start, sleeps in-process without an abort, persists nothing and holds the slot.
7. **`recursionLimit` counts super-steps per invocation** (`$LG/pregel/loop.js:458`), copied
   into subgraphs, reset on every invoke or wake. It throws `GraphRecursionError`.
8. **Writes before `interrupt()` are not committed.** The interrupt commit (`$LG/pregel/runner.js`,
   `_commit`) persists only `[INTERRUPT, …resumes]`. Completed tasks of the same super-step keep
   their writes as pending writes. The interrupt value is persisted and readable through
   `getState().tasks[].interrupts`. `getWriter()` chunks are not persisted. To persist a fact before
   an interrupt, use two nodes (one commits, the next interrupts).
9. **A `Command` input's `update` is applied before the resumed task runs.** `mapCommand` turns
   the update into null-task writes and `_first` applies them (`$LG/pregel/loop.js:873-878`),
   with or without `resume`. So the engine can push a fact into the root state on a resume or a
   re-run, for example `stopAt: null`. The update reaches the root namespace only; a body resumes
   from its own checkpoint.
10. **`Command.PARENT`** throws `ParentCommand` through `runBody` and applies as if the Subflow or
    For Each node returned it. Not needed: `runBody` already reads the body's end.

## Verdicts

| Candidate | Verdict | Why |
| --- | --- | --- |
| `TimeoutPolicy` / `heartbeat` for `timeoutMinutes` and `idleMinutes` | No | A timeout is a domain outcome here (`StepEnded error`, then a park). LangGraph's drops the node's writes and leaves it running (fact 1). |
| `RunControl.requestDrain` for stop after step and the stop time | No | Not persisted, never cancels a node, looks like a crash afterwards (fact 5). Possible later for a SIGTERM graceful shutdown. |
| `retryPolicy` instead of `planWait` | No | In-process sleep, nothing persisted, slot held (fact 6). |
| `recursionLimit` instead of `maxSteps` | No | Per invocation, not per run (fact 7). |
| `Command.PARENT` | Not needed | Fact 10. |
| One `waitNode` for Agent nodes and model Decisions | Done on main | Pure dedupe. |
| The walk reads only the Checkpoint | Partial | Writes before an interrupt are lost (fact 8), a daemon death mid-node leaves only the log, stop requests arrive mid-drive, and runs from before this engine have no checkpoint. |

## What this branch changed

The walk reads the Checkpoint where it is complete. The Event Log stays the read model for
people, and the source for crash recovery.

- **The Agent node reads the session to continue from the state** (`graph/nodes/agent.ts`,
  `lastSessionOf`): `state.nodes[id].session_id` first, the log only when it is empty.
- **A finished body's outputs come from its final state** (`graph/nodes/body.ts`): `runBody`
  returns the subgraph's `nodes`; `bodyOutputs` reads the log only for a failed body.
- **A wake reads the sleeping step from the wait interrupt** (`graph/runner.ts`, `wake`).
- **`stopAt` is a state channel** (`graph/state.ts`). The start input sets it; a resume past the
  stop time writes it null with the Command's `update` (fact 9); `beginStep` and the For Each loop
  read it from the state. A body reads its caller's through `configurable.stopAt`, which `runBody`
  sets on every invoke, because the update reaches the root only.
- **`pending.streak`** `{ count, since }` on a waiting step replaces the log's `waitStreak`.
  `planWait` takes it as is.
- **A Gate is two graph nodes** (`graph/nodes/choosers/person.ts`, `compile.ts`). The node opens
  the Gate and commits `pending: { kind: "gate", … }`; its ask node `ask__<id>` interrupts
  (fact 8). The log guard (`uncommittedStep` + `isAsked`) stays for the crash window between
  `GateOpened` and the checkpoint commit.
- **A finished run keeps its latest checkpoint** (`LibsqlSaver.pruneThread`). `resumeRun` of
  one re-enters it with `Command({ goto, update: { ended: null, pending: null } })` and the
  re-entered node's last visit taken back. `reentryUpdate` (the state rebuilt from the log) runs
  only for a thread with no checkpoint: a run from before this engine.

## What stays on the log, and why

| Site | Why it stays |
| --- | --- |
| `uncommittedStep` (`graph/context.ts`), used by the Gate, Subflow and For Each nodes | The step the log has and the checkpoint lacks: a daemon died while it ran (rule 5). |
| `deriveStopAfterStep` (`beginStep`, the For Each loop) | A person's request arrives mid-drive; nothing can write the state while a drive runs. |
| `countStepsSinceWalkBegan`, `countVisits`, `deriveSteps` in `beginStep` | Steps across scopes since the walk began; the visit number counts the uncommitted step too. |
| `entryOf` in `agent.ts`, `decision.ts` | A step recovery ended after a wake, the harness session of a step the checkpoint never saw, the resume prompt. |
| `foreach.ts` items, states and branches | Kept out of the state on purpose (rule 13), so checkpoints stay small. |
| `subflow.ts` `call.inputs` | The open step's bound inputs after a daemon death. |
| `deriveRunState`, `parkedSteps`, `deriveSteps` in the runner | The log says whether a run is stopped while its thread still sits at a wait or a Gate. |
| `reentryUpdate` | Runs from before this engine have no checkpoint. |

A `Command({ update })` on a thread pending at a node, `Command({ resume, update })` on a
parked body, the Gate's crash window and the finished-run re-entry each have a test:
`graph/state.test.ts`, `graph/gate-node.test.ts`, `graph/checkpointer.test.ts`,
`engine.test.ts` ("a finished run keeps its latest checkpoint only").

## Skipped

- Building the step signal with `AbortSignal.any([runSignal, AbortSignal.timeout(ms)])`
  (`graph/context.ts`). `AbortSignal.any` forwards the source signal's own reason, so the step
  signal's reason would no longer be an `AbortReason` (`agent.ts` reads `signal.reason ===
  "stopped"`), and an `AbortSignal.timeout` timer cannot be cleared when the step ends. Not
  behaviour-identical, so left as is.
