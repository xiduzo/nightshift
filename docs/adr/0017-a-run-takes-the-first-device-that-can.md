# 17. A run takes the first Device that can run its steps

Status: accepted, 2026-11-05. Replaces the parts of
[ADR 14](0014-a-node-names-its-device-by-id.md) and
[ADR 15](0015-a-schedule-always-runs-on-the-host.md) named below.

## Context

A flow named its Devices one node at a time, and a run without a choice went to
the computer that started it. Runs failed or waited in four ways:

- A run hopped between two installs on one Mac. A dev daemon and the desktop app
  both showed as "LE2316". One had every profile, and the other had none.
- An offline Device stopped a step until the Device came back. No other Device
  could take the step.
- The start dialog asked for a Device each time, so a person overruled the flow
  without meaning to.
- A step on a Device without the flow's tools failed late in the run.

## Decision

1. **One order for every start.** A run's steps go to the first Device of the
   order that can take them:
   - **Left empty:** the node's own Device, then the flow's list, then the
     Device the person started from.
   - **Picked:** the Device the person picks, then the node's own Device, then
     the flow's list, then the Device they started from.
2. **A flow has an optional list of Devices (`devices`).** Without a list, the
   flow's list is the Host that keeps the Space. The flow format does not change:
   a Night Shift that does not know the list reads the flow the same.
3. **A Device can take a step** when it is online, has the project, has what the
   step needs, and has a profile of the same name for a node that names a
   profile. A profile still belongs to one Device
   ([ADR 3](0003-a-profile-belongs-to-one-device.md)): the step uses that Device's
   own profile, with the node's own values on top.
4. **Steps without a Device of their own stay together.** They take one Device
   for the whole run, so a run does not make a Hand-off between each step.
5. **A step moves when its Device goes offline.** The step goes to the next
   Device of the plan. It stays and waits in two cases:
   - It has a session to continue. A session lives on its Device.
   - The run's work is only on an offline Device. The step would go on without it.
6. **A flow with a Service has no moves.** A Service stays on the Device it
   started on, and so do the steps that use it.
7. **A schedule's run stays on the Host (ADR 15).** Only a node that names a
   Device can move to a fallback. A schedule is not a pick, so it does not overrule
   the nodes.
8. **A development install is marked.** A dev daemon says so when it links, and
   it is named "<host> (dev)". It is never a fallback by default. It shows in a
   device list only on itself, or where a flow names it already.
9. **The run says what happened.** A Device that a run or a step passes over
   gives a warning on the run, with the reason.

ADR 14, decision 3 changes: a node that names a Device that left the Space no
longer stops a run when another Device can take the step. The flow check still
shows the error in the editor.

## Consequences

- A plan keeps its fallbacks on the run's row (`fallbacks`). Run bundles have
  format 9.
- A run started on a Mac without a pick now runs on the Host. A flow that needs
  that Mac must name it, on the flow's list or on its nodes.
- A Device that is not the first of its order takes the step over. The run warns
  about it, and says which secrets work there. Which secrets a step reads follows
  [ADR 18](0018-personal-secrets-stay-personal.md). A secret that the step needs and
  cannot read fails the step, as a missing secret does. Secrets are not checked when
  a Device is chosen.
- A step that moved goes on where it moved to, also when its first Device is back.
- A Device that cannot reach its Host still walks its own runs (ADR 1, decision
  10): the Host is passed over in the order.
- An older Host treats a start without a Device as a start on the Host. An older
  Device always names a Device, which counts as a pick.
