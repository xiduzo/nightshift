# Spike: Night Shift flows on LangGraph

**Date:** 2026-10-16 · **Branch:** `spike/langgraph` (throwaway) ·
**Code:** `packages/engine-langgraph` on that branch

**Question.** Could LangGraph (`@langchain/langgraph`, JS) replace the
engine's hand-rolled walk, event log, waits and resumes, so Night Shift
maintains less orchestration code? And would the flow nodes of the editor
sit on top of it?

**Answer.** Yes for the walk kernel, and the fit is good: every flow node
compiles to one graph node, the run state is checkpointed after each node
in Night Shift's own libsql database, and LangGraph's `interrupt` carries
both ways a run parks (a usage-limit or network wait, and a Gate). It does
not replace most of the engine: scheduling, worktrees, leases, transcripts,
the live bus, policy, GitHub, profiles and connections stay ours. Two gaps
need our own bookkeeping next to LangGraph (below).

## What was built

| File | Lines | What |
| --- | ---: | --- |
| `src/compile.ts` | ~690 | Flow JSON → `StateGraph`. Agent, Command, Decision, Gate, Subflow, For Each (json source). Edge choice reuses `nextEdge` from `@nightshift/flows`; edge `max`, chosen ends and failures behave as in the engine. |
| `src/checkpointer.ts` | ~300 | A `BaseCheckpointSaver` on `@libsql/client`, ported from the official SQLite saver. Tables `lg_checkpoints`, `lg_writes`. |
| `src/run.ts` | ~120 | Start, resume, state, history, fork. Thread id = run id. |
| `src/spike.test.ts` | ~300 | Seven tests with the fake harness. |
| `src/real.ts` | ~80 | One real Claude Code (haiku) session through the graph. |

Flows stay what the editor writes. The compile step is the only new thing
between a flow file and a run: "flow nodes on top of LangGraph" means
compile-to, not author-in.

### How the mapping works

- **State.** One zod schema: `inputs`, `nodes` (outputs by node id, merge
  reducer), `visits`, `traversals`, `steps` (append reducer), `loops` (For
  Each cursors), `pending` (a parked Agent step), `ended`.
- **A node** runs its step, picks the next edge with `nextEdge`, and returns
  `new Command({ update, goto })`. No conditional-edge functions; routing
  lives next to the step, like the engine's `walkScope`.
- **Usage limit or network.** The Agent node returns `goto: wait__<id>` with
  `pending` set (harness session id, resume prompt, reason, resetAt). The wait
  node calls `interrupt(...)`. The daemon's scheduler decides when to resume;
  resuming re-enters the Agent node, which continues the same harness session.
- **Gate.** `interrupt({ question, choices })`; the resume value is the choice.
- **Subflow and For Each bodies** are subgraphs invoked from the node with
  the config passed through, so they checkpoint under the node's namespace.
  For Each runs one element per super-step and jumps back to itself, which
  checkpoints the cursor after every element.
- **Live events.** Harness events go out through LangGraph's `custom` stream
  mode (`config.writer`), which is where the bus would hang.

## What was verified

All seven tests pass on Bun 1.3.10 with LangGraph 1.5.0 (`bun test`,
`tsc -b` clean, biome clean).

1. Agent → Command to a chosen end. One checkpoint per super-step (4 for a
   2-node flow), node outputs readable by templates (`{{worker.summary}}`).
2. A usage limit parks the run. A **new runner and a new client on the same
   database file** (a daemon restart) resumes it; the harness gets the same
   session id and the resume prompt; `visits` does not grow.
3. A Gate parks with its question and choices; the answer picks the edge.
4. An edge with `max: 2` stops a retry loop with the engine's message.
5. A Decision routes on the decider's label.
6. For Each over three elements with a usage limit inside the second: the
   run parks, resumes **inside the element** (same session), then runs the
   third. The parked chunk surfaces once per namespace; the runner keeps the
   root's.
7. Time travel: fork from the checkpoint after node `a`; only `b` runs again.

**Real run.** Claude Code on haiku through the existing TanStack harness,
unchanged: it wrote the file, sent the step report, the Command node read
`{{worker.summary}}`. 4 checkpoints, 12.7 s end to end, $0.0088. Checkpoint
blobs for that run: 2.7 KB in total.

## What LangGraph gives us

- The Pregel loop: super-steps, channels with reducers, a checkpoint per
  step, `interrupt`/`Command.resume`, subgraph namespaces, `getState`,
  `getStateHistory`, forking from any checkpoint, per-node `retryPolicy`,
  `Send` for parallel fan-out when For Each ever needs it, stream modes.
- That is the part of `engine.ts` in `walkScope`, `runStep`'s scaffolding,
  `beginWait`/`wake`/`resume`, and most of `events.ts`'s derivations. Roughly
  1,300 lines of ours become ~700 lines of thin glue in `compile.ts`.
- The API in 1.x has been stable (zod state, `Command`, `interrupt` are the
  documented way). MIT. Release cadence is steady, not churny.

## What it does not give us (stays ours either way)

Scheduler and nights, slots and leases, worktrees and per-item branches,
transcripts on disk, the bus and `watchRun`, run policy (wait planning with
backoff, network grace, `maxSteps`, stop-after-step, time caps, idle
minutes), stop with grace, take-over commands, profiles, connections and MCP
expansion, GitHub tools and the `EffectJournal`, the decider, For Each
sources other than json and the dependency ordering, run bundles, recovery
of runs the daemon died in. That is most of the engine's 16k lines.

## Gaps found, and what they cost

1. **A node's writes commit only when it returns.** If the daemon dies while
   an Agent session runs, LangGraph re-runs the node from its last checkpoint,
   which starts a **fresh** harness session. The engine today logs the harness
   session id mid-step and continues the **same** session. Fix: a small side
   table (thread, node, visit → harness session id) written when the
   `session` event arrives and read on re-entry. Same for the step's
   transcript path. This is bookkeeping outside LangGraph.
2. **Everything before `interrupt()` re-runs on resume.** Waits are their own
   nodes for this reason. Every node author must know the rule.
3. **Checkpoints copy the whole state.** Agent output text and For Each item
   lists are in the state, so each checkpoint grows with the run. Fine for
   tens of steps; a 50-element For Each with long outputs would make each
   checkpoint hundreds of KB. Mitigation: keep large outputs in our tables and
   only ids in the state. More bookkeeping.
4. **Two sources of truth for the UI.** Today the UI reads run and step rows
   plus transcripts. LangGraph's truth is the checkpoint blob. Either the
   runner projects graph updates into our tables as they stream (the same
   writes as today, in a different place), or the UI reads `getState`, which
   needs the run's flow snapshot compiled to read it. Projection is the
   realistic choice.
5. **Bun.** LangGraph core works. The official SQLite checkpointer does not
   (`better-sqlite3` is not supported in Bun), hence the ported libsql saver,
   300 lines that are ours to keep. The Postgres saver was not tried.
6. **Dependencies.** 54 new packages, including `@langchain/core`'s
   `langsmith`, `js-tiktoken`, `mustache`, `p-queue`.

## Recommendation

Adopt LangGraph as the run kernel, staged behind the existing `Engine`
interface, if the goal is to own less orchestration code:

1. Build `createEngine` v2 on the compiled graph and the libsql saver, with
   the same event/bus projection so the web app does not change.
2. New runs start on v2; runs already in flight finish on v1 (a run records
   its engine version). Delete v1 when none are left.
3. Add the side table for mid-step session ids (gap 1) and keep large
   outputs out of the state (gap 3) from day one.

Expected size: the engine core and its ~270 tests are rewritten, which is
two to three weeks of work; `engine.ts` loses the walk, waits and resumes;
`events.ts` becomes a projection. What we keep maintaining is the glue
(~700 lines), the saver (~300) and the projection, instead of the walk, the
event derivations and the resume logic.

Not recommended: a big-bang swap that also moves the UI onto checkpoint
state, or using LangGraph Platform/Studio; the editor is the product's
surface, and the daemon runs on the user's machine.
