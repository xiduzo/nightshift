# 31. The live cache owns what a save makes stale

Status: accepted, 2026-11-12. Built, 2026-11-12, in architecture series 3, lane L5
(43274360 to 5f3b0b67).

## Context

After a save, a screen must read again what the save changed. The web did this at each
call site: 114 mutations and 81 `invalidateQueries` calls in 52 files. The client kept
two more lists of the reads that a synced document holds. The `device` block of the live
cache named 7 prefixes, and the query client named 14. No test compared them.

The research found that most call sites were not the problem. Of the 81 hand reads, 38
repeated a read that the stream already did. The stale reads were gaps in the lists:

- A flow save did not read the lists built from flows: "Used in" and "Used by" on the
  Agents page, the project and Space Secrets lists, and the Knowledge sources.
- The kept values and the Since last run memory of the editor stayed stale for 10
  minutes after a run.
- The CLI tool check and the programs found kept the 10-minute time of a document read.

A read that a save forgets stays stale for 10 minutes (`DOCUMENT_MS`). After that, only a
mount or a window focus reads it again.

## Decision

1. **One table says what a change makes stale.** `@nightshift/client` (`changes/`) names
   each change: a synced document, a change the stream tells, or a change that only the
   saving screen knows. For each change, it names the reads that change makes stale
   (`staleAfter`).
2. **The same table says what each save route writes.** `SAVES` names, for each save
   route of the API, the changes it writes. A row is static: a route that writes a
   document for some inputs names that document.
3. **The query client takes its 10-minute list from the table.** A read that only a
   synced document changes stays fresh until the document changes, or for 10 minutes
   (`heldByDocuments`). The two lists cannot drift.
4. **A save needs no follow-up at its call site.** While the live cache follows the Host,
   it watches the mutation cache. Each save that succeeds reads at once what its row makes
   stale, on the web and on the phone. A failed save reads nothing. A screen reads again
   by hand only when it must wait for that read. Examples are the resets after sign-in or
   a Host change, the full reset after a project move, and the account check after a
   refusal.
5. **The stream's echo reads nothing.** Of the stream's items for the same change, the
   first in 300 ms is the echo of the save. It reads nothing. A second item reads as
   usual, so the save of another person in that window is not lost.
6. **`useChanged` is the door for the rest.** A job that ends, and a save through the
   client instead of a mutation, call it with what changed.
7. **A test holds the table to the router.** Every route of the API is a save with a row,
   a read, a stream or a route of the peers. A new route that is none of these fails the
   test. No row names a read.

## Alternatives

- **A hook per save.** Each save gets a hook with its follow-up. That is about 40 shallow
  hooks, and the list of document reads stays a second list.
- **A `changed()` call at each call site.** What a route writes stays spread over the
  screens, and a new screen can forget it.
- **A table of every route, typed to be complete.** The compiler would then find a
  missing route. But about 95 reads would get an entry that does nothing at run time. The
  test keeps the list of reads instead.

## Consequences

- The web screens of agents, flows, knowledge, projects, Spaces, devices, settings and
  notifications lost their hand follow-ups.
- A flow change reads the lists that say which flows use what, and the Knowledge sources
  and their review. A run that ends reads the Knowledge page again (`knowledge.get`). A
  stopped run does not, because that read first reconciles the knowledge folder for up to
  2 seconds.
- A change of a run reads the kept values and the memory. Only the CLI tools list keeps
  the 10-minute time.
- Personal secrets and invitations stay stale on other screens and on the Host's screens.
  Only a stream item can fix that, and that is a change of the wire.
- A write of the device document reads all 7 of its prefixes again, the mounted checks
  included. A narrower read needs a change of the wire too.
- No check refuses a new hand read. A check that allows `invalidateQueries` only in
  listed files would.
- The 91 mutation entries that only rename oRPC options stay for a later change.
