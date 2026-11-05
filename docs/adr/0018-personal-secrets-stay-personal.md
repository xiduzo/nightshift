# 18. Personal secrets stay personal, and a Space has secrets

Status: accepted, 2026-11-05. Changes [ADR 13](0013-a-secret-has-a-scope.md),
decisions 1 and 4.

## Context

ADR 13 lets a Person's steps read their Personal secrets on each of their Devices. A
Host counts as one when the Person owns it. A step on the Host therefore reads the
Personal secrets of the Host's owner. Since [ADR 15](0015-a-schedule-always-runs-on-the-host.md)
and [ADR 17](0017-a-run-takes-the-first-device-that-can.md), most steps run on the
Host. A Personal secret then works as a shared one, in every flow of the Host.

A secret that many projects share has no good scope. A Project secret must be saved
once per project.

## Decision

1. **A Personal secret stays on the Person's own computers.** A step on a Host reads
   no Personal secret, also when the Person owns that Host. The Host keeps the value
   for the Person's other Devices, as in ADR 13. A step on another Person's Device
   reads none, as in ADR 13, decision 5.
2. **A step that moves keeps this rule.** A step on the Person's own computer reads
   their Personal secrets, also when it moved there (ADR 17). A step that moves to the
   Host reads none.
3. **A Space has secrets.** Every step of a run in the Space can read them, on any
   Device. This also holds for a personal Space. The Host that keeps the Space keeps
   the values, encrypted with the key of ADR 13. The access rules are those of a
   Project secret: a Member sees the names, and a Member whose role saves Flows sets,
   moves and removes them.
4. **The Person's scope wins.** A `${NAME}` reads Personal, then the Space, then the
   Project, then this computer, then the environment.
5. **A secret moves to the Space without a new value.** The Move action of ADR 13,
   decision 7, also goes from this computer or Personal to the Space, and back.

## Consequences

- A flow on the Host that used a Personal secret fails until that secret moves to the
  Space or the Project. The refusal says this.
- A Person can override a shared secret for their own steps on their own computers.
  The same flow can then use another value on the Host.
- A computer with "Be a Host" on reads no Personal secret for its own steps either.
- A step asks for the values of its Project and its Space in one call. An older Host
  answers with the Project's values only, and refuses the calls for a Space's list.
- A secret on another Device moves to the Space in two steps: to Personal, then to the
  Space.
