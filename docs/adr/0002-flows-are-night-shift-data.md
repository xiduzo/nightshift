# 2. Flows are Night Shift data, not repository files

Status: accepted, 2026-10-27

## Context

Today a Flow is `.nightshift/flows/<name>.json` in a Project's Clone, and
`.nightshift/schedules.json` and `.nightshift/profiles.json` sit next to
it. Each Device reads them from its own Clone. This causes problems:

- Two Clones of one Project can hold different flows. A Run uses the flows
  of the Clone on its Device.
- Many teams do not let a person commit Night Shift files to a shared
  repository. The files stay untracked, so git does not carry them to the
  person's other Devices.
- A Phone or a browser on the Host has no Clone to read flows from.

## Decision

1. **Flows leave git.** Flows and schedules are Night Shift data. Night
   Shift does not read or write `.nightshift/` in a Clone.
2. **The Host keeps them.** The flows and schedules of a Project live in
   the Space that keeps the Project, as Yjs documents, like the Device
   document and the Space document. A Space without a Host keeps them on
   its one Device.
3. **Every Device keeps a copy.** Each Device of a Space holds the flow
   documents of the Space in its Replica. A Device can restore a lost Host.
4. **Offline edits merge.** A person can edit a flow on a Device that
   cannot reach the Host. The edits merge when the Link is back. A Run
   started offline uses the Device's copy.
5. **Every save is a version.** A version records who saved it, when, on
   which Device, and the change. A person can see the difference and
   restore a version. A Run records the version that it runs.
6. **A flow belongs to one Project.** "Copy into project" and JSON export
   and import move a flow between Projects. Kits stay the read-only flows
   that ship with Night Shift.
7. **Agents use Night Shift's tools.** An agent reads and saves flows only
   through `nightshift mcp` and the `nightshift` CLI. Night Shift checks
   every save. A save is a document edit, like a save in the editor.
8. **One import on upgrade.** The first start after the upgrade imports
   each Clone's `.nightshift/` flows, schedules and profiles once.
   - When git does not track the folder, Night Shift deletes it.
   - When git tracks it, Night Shift leaves it and shows a notice: remove
     it in a commit.
   - Project profiles become profiles of the importing Device
     ([ADR 3](0003-a-profile-belongs-to-one-device.md)).
   - When two Clones hold a different flow of the same name, both are
     imported. The second gets a suffix, and a notice names both.

## Consequences

- The run branch still travels through the git remote between Devices (the
  Hand-off). Only the definitions leave git, not the work.
- Webhooks address a Schedule by Project and id, as today. The Schedule now
  comes from the Space, not from a Clone.
- The `nightshift-flows` skill, the starters and the examples stop telling
  agents and people to edit `.nightshift/` files.
- A flow is no longer reviewed in a pull request. Versions (decision 5)
  take that place.
- Night Shift's own repository removes its committed `.nightshift/` after
  the import.
