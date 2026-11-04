# 15. A schedule always runs on the Host

Status: accepted, 2026-11-04. Replaces the parts of
[ADR 14](0014-a-node-names-its-device-by-id.md) about a schedule's Device.

## Context

A schedule named the Device its runs ran on. The Host has fired every schedule
since 2026-10-28, but a run could still go to a Device that sleeps or that left
the Space. One person, one project and one Host do not need that choice. It also
failed in practice. On 2026-11-03 the schedules of two projects held
`device: "LE2316"` in a document of format 2, where a `device` is an id. One Yjs
client wrote all of them in one change after the upgrade to ids. The change was
not an upgrade: it did not set the format, and an upgrade does. The value looks
like an id to the schema, so the save passed, no issue showed, and the page showed
"A device". The start would have been refused at its time.

The writer itself is not certain. The likely source is a full list save from a page
or a Night Shift that still held the old names.

## Decision

1. **A schedule has no Device.** Schedules format 3 removes `device`. The schema
   drops the field on every read and save, so a save of an older list cannot bring
   one back. Format 3 needs no name to id step.
2. **Its run runs on the Replica that keeps the Space:** the Host, or this
   computer in a Space without one. One function in the engine (`startForSchedule`)
   sets that Device for a cron start, a webhook and Run now. Run now on a Device
   goes to the Host.
3. **It never moves.** A Host without a copy of the project refuses the start.
   The schedule shows why. Night Shift does not pick another Device.
4. **A node still chooses.** A node that names a Device runs there. The run hands
   that step over. Only the run itself and its unplaced steps stay on the Host.
5. **The Host's owner decides for others.** A schedule of another Person keeps its
   `person`, and runs through the Offers of the Host. A saver without Offers on
   another Person's Host is refused.

## Consequences

- The schedule dialog has no "Runs on" choice. The card shows the Host and the
  Devices that the flow names.
- A device that a flow names and that left the Space shows as "Unknown device",
  and says to choose another one.
- A personal merge no longer pins schedules to the computer. Their runs go to the
  Host after the merge.
- Leaving a Host pauses every schedule that is on. The Host still fires them, and
  a run here too would be a second run.
- The phone warns about a computer only when a schedule's flow names it.
- An older Night Shift reads format 3. A `device` that it saves counts for nothing.
