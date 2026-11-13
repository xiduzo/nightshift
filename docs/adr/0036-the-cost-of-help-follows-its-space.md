# 36. The cost of help follows its Space

Status: accepted, 2026-11-13. Built, 2026-11-13.

## Context

ADR 35 keeps one record for each answer of the Builder, the Improver, the Explainer and
the Field writer (`answer_cost`). The record stayed on the computer that answered. Three
things followed:

- In a Space that a Host keeps, each computer showed only its own help cost. The Host,
  which the phone reads, showed almost none.
- A Space move took the runs of a Project along and left the help cost about that
  Project in the old Space.
- A Space that left a Replica left its records there.

Run history has an exchange between a Device and its Host: rows go by cursor, per Space
and Walker. An answer is not a run. It has no Walker, no steps and no events.

## Decision

1. **An answer has one key on every Replica.** `answer_cost.key` is written once, where
   the answer ended. A row that comes again is the same answer. No call adds a cost
   twice.
2. **The Host that keeps a Space has the cost of every computer in it.** A Device gives
   the Host its own rows that the Host lacks. The Host keeps each row in the name of
   the Device that sent it and of that Device's Person. It takes only rows of Spaces
   that it keeps and that the Person is a Member of.
3. **Every Replica of the Space reads the same cost.** The Host serves the rows of a
   Space after a cursor, in the order they landed there, the caller's own rows too. So
   the cursor of a Device is the Host's order: the highest number it has from that Host,
   per Space (`host_seq`). No cursor table.
4. **One call does both.** `sync.answerCosts` takes the Device's new rows and answers
   with the rows after its cursors. The Device calls it while its link is online, then
   every 30 seconds. A cost reaches the other computers within that time. Live is not
   needed: the Spend page reads a month.
5. **Not part of the run history exchange.** The exchange of runs keeps its rules and
   its cursors. An older Host has no `sync.answerCosts`: the rows wait on the Device.
6. **A Space move takes the cost of its Projects along** (`spaceMoveBatch`). A moved row
   takes the Project's id and the Person's id of the new Space. It loses the number and
   the receipt of the Host it came from, so it reaches the Host of its new Space as a
   new row. A split takes only the answers of the computer that leaves. A cost with no
   Project stays.
7. **A Space that left takes its records with it** (`forgetSpaceRows`).

## Consequences

- The Spend page and Settings show the help cost of the whole Space on every computer
  and on the phone.
- A Member of a Space reads what the answers of the other Members cost, as they read
  the cost of their runs.
- A Host that was offline has the cost after its next link. A Host of an older version
  has it after its update.
- A cost that a Host moved to another Space after a Device read it stays in the old
  Space on that Device. The Host has the right total.
