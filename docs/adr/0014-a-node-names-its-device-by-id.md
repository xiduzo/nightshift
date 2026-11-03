# 14. A node and a schedule name their Device by id

Status: accepted, 2026-11-03

## Context

A node's `device` and a schedule's `device` named a Device by its name
("LE2316"). Run start found the Device with that name among the Devices
of the Person who started the run. Two Night Shift installs on one Mac (the
desktop app and a development daemon) both registered as "LE2316". A run
then went to the wrong one and refused: "LE2316 does not have this
project." A name is a label that a person chooses and can change. It is
not an identity.

A profile already names its Device by id
([ADR 3](0003-a-profile-belongs-to-one-device.md)).

## Decision

1. **A node and a schedule name their Device by its id.** Flow format 8:
   a node's `device` is the Device's id. A schedule's `device` is the
   Device's id too (schedules format 2, `schedulesVersion` in the flow
   document's `meta`).
2. **A name is display only.** The editor, the Schedules page, the canvas
   and the phone look up the name of an id in the Space's Devices. Night
   Shift never finds a Device by its name to validate or to run a step.
3. **An unknown id is an error, not a crash.** A Device that left the
   Space shows "This device is no longer in this Space. Choose another
   device." The run does not start.
4. **The upgrade resolves a name only when it is sure.** A node or a
   schedule of an older format names a Device by its name. The upgrade
   takes the Devices of the Space, the Person's own first, then this
   computer, then the others. When exactly one Device in the first group
   with that name has it, the name becomes that Device's id. Otherwise the
   name stays as `{ "name": "LE2316" }`. The flow check and the schedule
   check then ask the person to choose the device again. A schedule with
   such a name does not start. Night Shift never guesses.

## Consequences

- Two Devices with one name never take each other's steps. A rename
  changes no flow and no schedule.
- An older Night Shift does not read a flow of format 8. A schedule whose
  Device an older Night Shift reads as a name finds no Device.
- The Replica that keeps the Space brings its flows and schedules to the
  new format once, at start. A flow gets a revision "Updated by Night
  Shift". A read before that upgrade migrates the same way.
- A run that started before the upgrade keeps the names in its plan, and
  its steps still find their Devices by those names.
