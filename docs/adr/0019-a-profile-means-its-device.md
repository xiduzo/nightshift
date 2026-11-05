# 19. A profile means its Device

Status: accepted, 2026-11-05. Replaces decision 3 of
[ADR 17](0017-a-run-takes-the-first-device-that-can.md) for a node with a
profile, and the part of its decision 1 where a pick overrules such a node.
[ADR 3](0003-a-profile-belongs-to-one-device.md) stands again in full.

## Context

ADR 3 says that a node names a profile and a Device as one pair, and that Night
Shift never uses another Device's profile with the same label. ADR 17 let a Device
take a step when it had "a profile of the same name". On 2026-11-05 this happened
in a run of `exploratory-testing`:

- The person picked the desktop app. It had no `builder` profile.
- The node named `builder` of a development install. That install was offline.
- The Host had a profile that was also called `builder`, and it took the step.

The flow needs the Mac, because the Mac reaches the system under test. The Host
cannot. A `builder` on another Device can also be another harness or model.
The name did not say what would run, and the run went to a place that the flow
did not name.

## Decision

1. **A profile means its Device.** Every choice of a profile is a choice of a
   Device. Night Shift never finds a profile on a Device by its name.
2. **A node lists its backups as pairs.** An Agent node, and a Decision or a
   Value decided by a model, has an optional ordered list `fallbacks` of
   `{ device, profile }`. The list is on the node because the nodes of one flow use
   different profiles.
3. **No backups: the step waits.** A step whose Device is offline waits for it,
   up to the stop time (ADR 3, decision 3). A flow that needs one computer lists
   no backup.
4. **The first pair that can takes the step.** A pair can take a step when its
   Device is online, has the project, has what the step needs, and still has that
   profile. A pair that fails says why in the run's warning.
5. **A pick chooses among the pairs.** A Device that a person picks at the start
   goes first only for a node that lists a profile on that Device. Other nodes with a
   profile stay on their own pair. The pick still places the steps without a
   profile.
6. **A cascade has no backups.** Its next tier is its backup. A node with both
   does not pass the flow check.
7. **A flow's `devices` list stays for steps without a profile.** ADR 17 still
   decides those steps: the pick, the node's `device`, the flow's list, then the
   Device the person started from.

## Consequences

- A person can read what can run a step, on which computer, from the node alone.
- A flow that relied on a profile of the same name now waits for its Device. The
  person adds a backup to allow a move.
- The flow check marks a backup whose Device or profile is gone. A backup that
  goes missing between the check and the start is passed over, with a warning.
- The list of profiles a flow uses includes its backups, so the Agents page shows
  a backup as used. The Devices that a schedule warns about do not include backups:
  the step has somewhere else to go.
- The flow format does not change. A Night Shift that does not know `fallbacks`
  reads the flow and runs the step on the node's own profile.
