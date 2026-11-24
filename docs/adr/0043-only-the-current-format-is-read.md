# 43. Only the current format is read

Status: accepted, 2026-11-24. Built for flows, runs and revisions in the forward series. It
amends ADR 3 and ADR 14: their upgrades are gone. It amends ADR 15: no start of Night Shift
brings the schedules up. Those ADRs stay as written.

## Context

Night Shift read every flow format from 1 to 9. A chain of eight steps brought a flow up at
each read. Two more readers did it again: one with the Devices of the Space, and one that
rewrote the flow documents at each start. The chain and its tests were about 7,000 lines.

Every install keeps its current flows in format 9. Only history is older: runs and revisions
from before 2026-11-12. The chain loses fields of these, so a page showed a flow that never
ran.

## Decision

1. **One reader.** `readFlow` (`packages/flows/src/flow/schema/read-flow.ts`) reads JSON as a
   flow. It looks at the version first. It gives the flow, or why there is none: `older`,
   `newer` or `invalid`. Every stored flow, copy and file goes through it.
2. **No flow is changed to make it fit.** An older flow stays as it is stored. Only a person
   deletes it.
3. **The words live once.** An older flow says "An older version of Night Shift made this
   flow."

| What meets an older flow | What it does |
| --- | --- |
| The list of flows | Shows its name with one error. It has no nodes |
| A start, a schedule, a Call | Refuses |
| A save, a restore, an import over it | Refuses (`conflict`). The document does not change |
| A shape or a type from a run | Writes nothing |
| A delete by a person | Works. The revisions stay |
| The revisions | Lists each one. One of an older format has no flow and no diff |
| A restore of an older revision | Refuses |
| A run page | Has the steps, the costs and the answers. Its flow has no nodes, and `flowUnread` says why |
| A list of runs, a dashboard | Counts the run as before |
| Run again, resume, an answer | Refuses: "This run is from an older version of Night Shift. Start the flow again." |
| A start of Night Shift | Ends an open run of an older flow as `interrupted` with that reason, its Gates and waits too. The other runs continue |
| A batch of another Device | Lands as it came |
| A flow file | Refuses the import |
| A newer flow | Is not listed, as before. A run of one does not end at a start: an update can continue it |

`flowUnread` is optional and `flow` is never null, so an older phone reads the page.

## Consequences

- The format changes with a new version only when every install can follow at once. The
  change that raises the version removes what it cannot read, or leaves it as history.
- The revision kind `upgrade` stays readable: the history has such revisions. Nothing writes
  one.
- A profile that still has the old `tools` setting loses that setting. No install has one.
- The undo is the build before this one: nothing is rewritten, so it reads all of it again.
  Only an open run that a start ended keeps its end.
