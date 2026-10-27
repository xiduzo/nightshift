# 3. A profile belongs to one Device

Status: accepted, 2026-10-27

## Context

Today an Agent Profile or a Model Profile has a name. Each Device defines
its own profiles, and a Project can define profiles in
`.nightshift/profiles.json`. A node names a profile. When the Device that
runs the step has a profile of that name, it wins over the Project's
profile. So "builder" can mean a different harness or model on each
computer, and a reader of the flow cannot tell which one runs.

## Decision

1. **A profile belongs to one Device.** Its identity is the Device and the
   profile's id. Its name is a label. Two Devices can each have a profile
   labelled "builder".
2. **A node names the pair.** An Agent node, a Decision node or a Value
   node references a profile by Device and profile id. The editor shows the
   label and the Device ("builder on LE2316"). A person picks and
   configures that exact pair.
3. **No fallback by label.** When the Device is offline, the step waits
   for it ([ADR 1](0001-one-personal-space-per-home-host.md), decision
   11). Night Shift never uses another Device's profile with the same
   label.
4. **Project profiles go.** A Project has no profiles of its own. The
   import of `.nightshift/profiles.json`
   ([ADR 2](0002-flows-are-night-shift-data.md), decision 8) turns each
   project profile into a profile of the importing Device. The nodes that
   named it then reference that new profile.
5. **Sharing does not change.** In a personal Space, every profile of the
   person's Devices is available
   ([ADR 1](0001-one-personal-space-per-home-host.md), decision 2). In a
   shared Space, another Person's profile is available only through an
   Offer.

## Consequences

- A profile placement is explicit. The profile's Device is where the step
  runs, so placement rule 2 ("the profile's Device") becomes exact.
- A flow that references a profile on a Device that the Space no longer
  has does not start. The editor marks the node and asks for another
  profile.
- Renaming a profile changes no flow, because flows reference the id.
- A node can still set a field itself (model, effort, permission mode). A
  field that the node sets wins over the profile.
