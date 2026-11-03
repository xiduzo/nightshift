# 13. A Secret has a scope

Status: accepted, 2026-11-03. Personal built, 2026-11-03. Project built, 2026-11-03.

## Context

[ADR 1](0001-one-personal-space-per-home-host.md), decision 3, keeps every
Secret value on its Device. Each Device keeps its own copy of a value, and
a step runs only on a Device that has it. In practice:

- The same token is saved again on each Device of the Person. A new Device
  starts with no Secrets, and the Person must find each value again.
- A Project's Secrets (a database URL, a test account) belong to the
  Project, not to a computer. A Member who runs the Project on their own
  Device must get the values from someone and save them by hand.
- The Host fires schedules ([ADR 1](0001-one-personal-space-per-home-host.md),
  decision 8), so the Host needs a copy of each Secret that its runs use.

## Decision

1. **A Secret has a scope.** There are three:
   - **This computer.** The value stays on one Device, as today.
   - **Personal.** The value belongs to the Person. Their steps on any of
     their Devices can use it, in any Space.
   - **Project.** The value belongs to one Project. Every step of a run of
     that Project can use it, on any Device that runs the step.
2. **The Host keeps Personal and Project values.** The Person's Home Host
   keeps their Personal Secrets. The Host that keeps a Space keeps the
   Secrets of its Projects. A Device without a Home Host keeps both itself.
   The Host encrypts each value at rest (AES-GCM) with a key of its own. It
   reads that key like the auth secret: the environment, then the secrets
   folder, else it makes one in the data folder (0600).
3. **A value goes to a step, not to a Device.** When a step starts, its
   Device asks the Host for the values that the step needs. The Host gives
   a value only when the run's Project, the step's placement and the
   Device's owner all allow it. The Device keeps the value in memory for the
   step only. It never writes it to its keychain, database or log.
4. **The most specific scope wins.** A `${NAME}` reads the Project's Secret,
   then the Person's, then this computer's, then the environment.
5. **A Personal Secret goes only to the Person's own Devices.** A step on
   another Person's Device, through an Offer, never gets it. A Guest Host
   never keeps it.
6. **Who may set a Project Secret.** A Member whose role may save Flows sets,
   replaces, moves and removes a Project's Secrets. Nobody reads a value
   back. Members see the names, who set each one, and when.
7. **Move, do not type again.** A Secret moves from one scope to another
   without the Person typing it again. The Device that has the value reads
   it, stores it in the new scope, then removes its own copy. A Secret on
   another Device moves only while that Device is online.

## Consequences

- This replaces [ADR 1](0001-one-personal-space-per-home-host.md),
  decision 3, for Personal and Project Secrets. Secrets of "This computer"
  still never leave their Device.
- The Host admin can read the Personal and Project values that their Host
  keeps. They can already read the runs and transcripts there
  ([ADR 1](0001-one-personal-space-per-home-host.md), decision 7). The
  join screen and the Project Secret dialog say so.
- A Project Secret is as safe as the Flows that can read it. Every Member
  who may save the Project's Flows can write a Command that sends the value
  away. The dialog says: "Everyone who can change this project's flows can
  use it."
- A step needs its Host to start when it uses a Personal or Project Secret.
  An offline Device waits, as it does for a Host call today.
- The masking of values in output and in a Run Bundle covers every scope.
- The Secrets page shows the scope of each Secret. The Project page gets a
  Secrets section.
- End-to-end encryption to each Device was rejected for now. Device keys are
  login tokens, not key pairs. A new Device or Member would wait for an
  online Device that has the value to share it.
