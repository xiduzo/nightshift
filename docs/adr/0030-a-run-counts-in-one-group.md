# 30. A run counts in one group

Status: accepted, 2026-11-12. Built, 2026-11-12, in architecture series 3, lane L3
(391b2482, 71b424d3, 3fb679e5).

## Context

Each screen put a run's status in a group of its own. Six or seven copies decided the
groups. They were in the phone's Runs chips, its Watch tiles and Running now, web Home's
Running now, the web run details and the client's progress groups. They disagreed in two
places.

- **Failed.** The phone's Watch tile "Failed" counted failed and interrupted runs. A tap
  on it opened the Runs chip "Failed", which showed failed runs only. The interrupted
  runs showed under the Stopped chip. Web Home's Failed lane, the project page and Flow
  health count `failed` only, because the engine's dashboard does.
- **Running now.** Web Home showed running and asleep runs. The phone's Watch showed
  running runs and runs at a Gate. Its "Runs" link opened the Running chip, which shows
  running and asleep runs.

The history of the Failed tile:

1. On 2026-10-23 the first chips put interrupted runs under Failed (f4074560). The tile
   followed the chip (2d55090b): "as the Failed filter of Runs does".
2. On 2026-10-31 the night watch added a Stopped chip and a Stopped tile (3d7883d2). The
   chip moved interrupted runs under Stopped: "An interrupted run stopped before its work
   was done." The tile kept failed and interrupted runs, with its old comment that it
   counts as the chip does.

`docs/research/mobile.md` records the state of 2026-10-23: the Failed tile and the Failed
chip count interrupted runs, and "a stopped run shows only under All". The record is older
than the Stopped chip. Its second half is false since 3d7883d2.

## Decision

1. **One table decides the group.** `statusOf` in `@nightshift/client`
   (`runs/status.ts`) gives a run's word, its look, its group and whether it ended.
   `groupStatuses` and `groupCounts` read the same table. Web Home, the web run pages,
   the phone's Runs chips, Watch and every list of runs read it. Only the look (icons and
   colours) stays in each app.

   | Group | Statuses |
   | --- | --- |
   | Running | running, sleeping |
   | Needs you | waiting |
   | Failed | failed |
   | Stopped | stopped, interrupted |
   | Finished | finished |

2. **An interrupted run counts as stopped.** Night Shift stopped during a step, so the
   run stopped before its work was done. The newest stated intent says so (3d7883d2), and
   the engine's dashboard counts `failed` only. On this point, `docs/research/mobile.md`
   is history.
3. **Running now is running and asleep, everywhere.** An asleep run is on its way: it
   waits for a time, a check or a Signal, and then continues. A run at a Gate counts where
   the person acts: Waiting for you on web Home, Needs you on the phone.
4. **A tile and the chip it opens count the same runs.** The phone's Failed tile counts
   failed runs. Its Stopped tile counts stopped and interrupted runs. The tile hints say
   so.
5. **A run's screen reads one answer.** `runNow(run, live)` in `@nightshift/client`
   (`runs/run-now.ts`) gives both run screens the status to show, what the run allows and
   why not, and its notice as parts. The Gate a run waits at is its oldest open Gate, on
   every screen.

## Alternatives

- **An interrupted run counts as failed.** This follows `docs/research/mobile.md` and the
  first chips. But the phone's Failed would then differ from web Home's Failed lane and
  from Flow health. Night Shift also resumes an interrupted run by itself, so it is not a
  failure of the flow. To change it, edit one row of `status.ts`, its test and two tile
  hints.
- **Running now holds the runs at a Gate too.** This was the phone's Watch. But a run at
  a Gate already shows where the person answers it. It would count twice on one screen.

## Consequences

- A new status needs one row in the table. The type system then asks each app for its
  look (`Record<StatusKey, …>`).
- A run that waits for a Signal is asleep, so it counts in Running now. Its page offers
  to send the Signal. To count it under Needs you, each row of a list needs the reason of
  its wait.
- Watch's fallback count ("N runs are at work") comes from the engine's dashboard
  (`open.running`). It counts running runs only, not asleep ones.
- The lock screen and the widget show "Finished" for a run that had nothing to do. Their
  status text takes no result yet.
