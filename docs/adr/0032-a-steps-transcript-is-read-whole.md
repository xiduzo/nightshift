# 32. A step's transcript is read whole

Status: accepted, 2026-11-12. Built, 2026-11-12, in architecture series 3, lanes L6
(7c2058e9, 3ed71084) and X3 (6bcfb699, b0cd22f8).

## Context

An assistant reads a run to explain it: the chat in the editor, Ask why, and the
`get_run` tool of `nightshift mcp`. It reads the end of the failed step's transcript. The
daemon read it from the run's stream until the stream was silent for 750 ms, at most 5
seconds in all. The stream sends what the run saved, then what comes live, with no mark
between the two. So a slow Host or a long transcript gave a part of it, and nothing said
so.

The facts around that read had copies too. The daemon walked the called flows of a run to
find the flow each step ran in. It had its own rule for the step the run failed at. The
CLI had its own copy of the report rule (`reportOf`), because `apps/server` does not import
`@nightshift/client`.

The engine can read a step whole. The peers' `stepEntries` returns once the step ended and
its last entry went out. It reads this computer's file, the archive or the Host, on any
Device. The daemon needed no wire change for it. The API had no such read: `runs.watch` was
the only route with a transcript.

## Decision

1. **The engine reads a run for an assistant.** `runReading(detail)` gives the called flow
   each step ran in (`flowOf`) and the step the run failed at (`failedStep`). One walk
   (`read/called-flows.ts`) serves it and the Subflow runs of a run's summary.
2. **A step's transcript comes from what the run saved, whole.**
   `SpaceEngine.stepTranscript(runId, stepId, signal)` gives the entries and what they
   hold. No idle timer decides where a transcript ends.
   - `whole`: the step ended, and this is all of it.
   - `so-far`: the step still runs, and this is what this computer saved until now.
   - `cut`: the read stopped before the end.
3. **The answer says when a transcript is not whole.** `get_run` adds one line: the step
   still runs, or Night Shift could not read all of it.
4. **`chatRun` bounds the read at 10 seconds** (`TRANSCRIPT_MS`). The daemon and
   `nightshift mcp` both read a run through it. The peers' read tries again while a Host
   is away, and the tool call of an agent must not hang. A read that hits the bound is
   `cut`.
5. **The API has the same read.** The route `runs.stepTranscript({ runId, stepId })`
   gives `{ entries, holds }` from `SpaceEngine.stepTranscript`. `get_run` over
   `nightshift mcp` reads the failed step with it. The route is new: no other route and
   nothing of the peers' protocol changed.
6. **The route stops after 8 seconds** (`STEP_TRANSCRIPT_MS`). It then answers what it
   read, marked `cut`. A client that aborts first gets no answer, and it loses what came. 8
   seconds is below the 10 seconds of `chatRun`, so the `cut` answer arrives with its
   entries.
7. **The CLI keeps the old read for an older Night Shift.** A daemon without the route
   answers a plain 404. Then the CLI reads the step from `runs.watch`, with the idle timer
   of before. A NOT_FOUND that the route declares (an unknown run or step) does not start
   the old read.

## Alternatives

- **Keep the idle timer, with a longer wait.** No new route. But the wait is a guess: a
  slow Host still gives a part, and every read waits the full silence.
- **One engine method that gives the detail, the facts and the transcript.** The CLI
  cannot reach it without a route, so the facts would stay copied in the CLI.
- **A transcript as a stream of entries.** `holds` would then need a second channel, and
  every reader wants the whole list.
- **A route with no bound.** A read over the API could hang while a Host is away. A
  client that aborts first would lose the entries read.

## Consequences

- The report of a run is one rule (`runReport` in `@nightshift/engine/run-status`). The
  web, the phone and the CLI read it. The CLI's copy is gone.
- A step that still runs on another Device gives no lines. This computer keeps none of it
  until the step ends.
- Only a comment ties the 8 seconds of the route to the 10 seconds of `chatRun`. A change
  of `TRANSCRIPT_MS` must keep the route below it.
- The CLI's watch read and its wall-clock test can go once no CLI talks to a daemon
  without the route.
- Two functions tell that the other side does not have a route: `isMissingOnHost` in the
  client and `isMissingRoute` in the CLI. No module that both the client and the server
  may import holds that rule.
- Ask why reads the run once, not twice.
