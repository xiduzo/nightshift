# 42. A leave pauses schedules on the leaving computer only

Status: accepted, 2026-11-24. It amends ADR 1 (leaving keeps a copy) and the order of a
merge. ADR 1 stays as written.

## Context

A leave gives this computer its own Personal and pauses its schedules, because the Host
still fires them. A Project keeps its id and its flow document on both sides. The pause was
a write in that document. When the computer joined the same Host again, the write reached
the Host. It also competed with what a person changed on the Host, and Yjs chose by writer.

A merge asks the Host for an answer and moves the rows later. The Projects of Personal can
change between the two.

## Decision

1. **A pause is a record of the leaving computer** (`space_split.paused`), in the batch that
   moves the rows. The flow document does not change, so no pause reaches a Host, and what
   a person did on the Host stays. The schedule store (`ScheduleStore`) reads a recorded
   schedule as off and of no Person while no Host keeps the Space of its Project. Every
   reader of schedules and both ways that one fires use that store.
2. **A person ends the pause.** A schedule that a person turns on there, or removes, leaves
   the record. A save that leaves it off keeps its state in the document.
3. **A join of the same Host, as the same Person there, needs no restore.** The Host keeps
   the Space again, so the record no longer applies. To another Host, another Person or
   another Project, the merge first turns the schedule off in the document.
4. **A split that moved no row is forgotten when its home Host gave access back.** Only its
   row goes. The copy of the database stays. A guest join forgets nothing.
5. **A leave ends before a merge starts.** A merge is held while a split is not done.
6. **A merge takes every Project of Personal.** It asks the Host again when the Projects
   are not those it answered for. No Project comes into a Space while a move takes its
   Projects. The batch fails, and no row lands, while a Project is left.
7. **A Project that an older version left in the old Space goes to the Host by itself.**
   It needs the Host online, the same Personal, no run that is not done, and an old Space
   that is gone. A copy of the database comes first. The Flows page of the Project says so.
   A batch that failed waits for the next start. A Host that refused waits an hour.
8. **Flows that wait for the Host when a split moves the rows merge after its batch**
   (`space_split.waiting`), apart from what the Host has: each schedule takes an id of its
   own and is off, and each flow is younger than every flow of the Host.

## Consequences

- A build from before this record does not know it. On a computer that left with this
  version and then starts an older one, the paused schedules fire there too.
- A split from before this record wrote its pauses into the document. Those stay off.
- What a person changed here while apart is a change of that person. When a person changed
  the same schedule on the Host, the flow document keeps one of the two.
