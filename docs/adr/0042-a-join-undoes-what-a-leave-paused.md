# 42. A join undoes what a leave paused

Status: accepted, 2026-11-24. It amends ADR 1 (leaving keeps a copy) and the order of a
merge. ADR 1 stays as written.

## Context

A leave gives this computer its own Personal and pauses its schedules, because the Host
still fires them. A Project keeps its id and its flow document on both sides. When the
computer joined the same Host again, the document synced, and the pause was the last write.

A merge asks the Host for an answer and moves the rows later. The Projects of Personal can
change between the two.

## Decision

1. **A split keeps each schedule as it was before it pauses one** (`space_split.paused`).
   A join of the same Host, as the same Person there, turns on each one that nobody
   changed, with the Person it ran as. It does so once the rows are the Host's again, and
   before the documents of their Projects sync. A split from before this record turns none
   on: Night Shift never guesses a schedule on.
2. **A split that moved no row is forgotten when its Host gave access back.** Its schedules
   are on again first. Only that row goes. The copy of the database stays. A split that
   moved its rows ends.
3. **A leave ends before a merge starts.** A join finishes the leave before its link
   starts, and a merge is held while a split is not done.
4. **A merge takes every Project of Personal.** It asks the Host again when the Projects
   are not those it answered for. No Project comes into a Space while a move takes its
   Projects. The batch fails, and no row lands, while a Project is left.
5. **A Project that an older version left in the old Space goes to the Host by itself.**
   It needs the Host online, the same Personal, no run that is not done, and an old Space
   that is gone. A copy of the database comes first. The Flows page of the Project says so.
   A batch that failed waits for the next start, so the copies do not pile up.
6. **A split merges the flows that wait for the Host before it ends their merge.** Only the
   row of that merge names the Project each of them goes to.

## Consequences

- A schedule that a person edited on the Host and that this computer paused has two
  writers while they are apart. The flow document keeps one of them, as before.
- A schedule that a person turned on and off again while apart stays off: it names a Person.
- A Project that comes back under another id on the Host keeps its own schedules there.
