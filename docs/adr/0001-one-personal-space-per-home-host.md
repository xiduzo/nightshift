# 1. One personal Space per Home Host

Status: accepted, 2026-10-27. Built, 2026-10-28.

## Context

A Device that joins a Home Host has two personal Spaces: its own
"Personal", which only that Device keeps, and "Personal on <Host>", which
the Host keeps. They do not share anything:

- The same repository becomes two Projects, one in each Space, with two run
  histories.
- A Project in the Device's own "Personal" can place steps only on that
  Device. The Host and the person's other Devices, and their profiles, are
  not available there.
- A Phone sees only the Spaces that its Host keeps. It does not see the
  Device's own "Personal".
- A schedule that names no Device fires on the Replica that keeps its
  Space. When the same repository is in both Spaces, both fire it.

The person expects one personal Space across all their computers.

## Decision

1. **Merge on join.** When a Device joins its Home Host, its own personal
   Space and the person's personal Space on that Host become one Space. The
   Host keeps it. A Guest Host never merges: it gets only shared Spaces.
2. **Shared by default inside the personal Space.** All Devices of the
   person, and their Agent Profiles, CLI Tools and Connections, are usable
   in the personal Space without Offers. Offers stay the way to share with
   other Persons.
3. **Secret values stay on their Device.** Every Device of the person sees
   the secret names of each Device. The values stay in the Device's
   keychain or environment. A step that needs a Secret runs on a Device
   that has it.
4. **Everything moves.** On join, the Device's Projects, Clones, Runs,
   Events, Gates, kept variables, flows and schedules move into the merged
   Space. The Host archives them like any other Run.
5. **One Project per remote.** A remote that exists on both sides becomes
   one Project with a Clone per Device. The runs of both sides stay under
   it. For a kept variable, the latest write wins.
6. **Leaving keeps a copy.** When the Device leaves its Home Host (Remove
   access, or `nightshift leave`), it splits off a new personal Space of
   its own. That Space gets the Projects that the Device has a Clone of,
   their flows and schedules, and the Runs that the Device walked. The
   Host keeps everything too.
7. **Any Host can be a Home Host.** When the person is not the Host admin,
   the join screen says that the Host admin can read their personal runs
   and transcripts.

## Defaults in a Space that a Host keeps

These follow from the merge. They apply to every Space that a Host keeps,
personal or shared.

8. **Schedules fire on the Host.** A schedule that names no Device fires
   on the Host of its Space. It fires once.
9. **The Host walks, the step runs where you are.** A Run started from a
   Device has the Host as its Walker. A step without a placement runs on
   the Device that started the Run. A Run started from a Phone or a browser
   on the Host runs its unplaced steps on the Host.
10. **Offline work syncs later.** A Device that cannot reach its Host can
    start and walk Runs itself, as their Walker. The Exchange sends them to
    the Host when the Link is back. A step placed on another Device waits
    until the Link is back (decision 11).
11. **A step waits for an offline Device.** A step placed on a Device that
    is offline waits until that Device is online, up to the Run's stop
    time. A Run without a stop time waits until a person stops it. When the
    wait starts, the person the Run runs for gets a notification: "<flow>
    waits for <device>".

## Consequences

- "Personal on <Host>" disappears from the UI. A person has one Space
  named "Personal".
- The Phone sees all personal work, because the Host keeps it.
- On a Home Host that another Person runs, the Host is usable in your
  Personal only through the Host admin's Offer. The start default skips
  it otherwise.
- A Device that leaves also takes the Projects that it walked a run of
  without a Clone, so each Run that it walked keeps its Project. A
  schedule of those Projects that names another Device fires on the
  leaving Device.
- A Device without a Home Host keeps its own personal Space, as today.
- The merge is a migration of rows between Spaces. Every row carries its
  Space id (TECH constraint), so the migration rewrites Space ids and the
  Host takes the result through the Exchange.
- The placement rule does not change (node, profile, Run's Device, Walker).
  Only the default of the Run's Device and of the Walker change.
- A Run starts when a placed Device is offline, also its own Device. Its
  steps wait for that Device (decision 11). When the Run's Device is
  offline, its Worktree is made when the Device is back, and
  `WorktreeCreated` names it to every Replica.

See also [ADR 2](0002-flows-are-night-shift-data.md) and
[ADR 3](0003-a-profile-belongs-to-one-device.md).
