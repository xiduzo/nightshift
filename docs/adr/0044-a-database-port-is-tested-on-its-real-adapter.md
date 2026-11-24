# 44. A database port is tested on its real adapter

Status: accepted, 2026-11-24. Built in the forward series. It amends ADR 40, decisions 3 and 7,
and ADR 41, decision 8 and its alternative "No twin for a store of SQL". Those ADRs stay as
written.

## Context

ADR 40 gives each driven port an in-memory twin and one contract suite for both. ADR 41 waited
for a pilot before it let a store of SQL go without a twin. The pilot ran on three slices:
`spaces/personal` of auth, `space-move` and `runs/views` of the engine.

| What | With the twins | On the real adapter |
| --- | --- | --- |
| Mutants of use cases and adapters that turn the slice red (of 114) | 82 | 92 |
| Mutants that only the twins turned red | 0 | - |
| CPU time of the three slices | 6.8 s | 7.6 s |

The twins hid faults. `forgetRows` of `space-move` could delete the rows of every Space, and its
slice stayed green. One use-case test asked for a state that SQLite refuses.

`migratedDb()` of `@nightshift/db/testing` makes a database in memory from the text of the
schema. So a new database in each test is cheap.

## Decision

The three rings and the use-case tests stay, and only the in-memory twin of a database port goes.

1. **A database port** has a real adapter that is drizzle over SQLite: `drizzle-<port>.ts`.
2. **It has no in-memory twin and no contract suite.** Its adapter has one test beside it,
   `drizzle-<port>.test.ts`, over `migratedDb()`.
3. **A use-case test runs on the real adapter, through the port.** The `test-support.ts` of the
   slice gives the ports over a database in memory, with functions that put and read rows. A
   use-case test imports the `test-support.ts` of its own slice only. It imports no database, no
   drizzle and no real adapter, and it never gets the handle.
4. **A test injects a failure by overriding one method of the real port**:
   `{ ...store, commit: async () => { throw new Error("x"); } }`.
5. **Twins stay** for files, processes, the network, the clock, the runner, and the ports that
   another slice or package fills. A port with a twin keeps its contract suite for both adapters.
6. **The ring check (H2, H7, H8) and the generators hold these rules.** `bun run gen adapter`
   with `drizzle` writes the adapter, its test and its line in `test-support.ts`.

## Alternatives

- **Keep the twins.** Each twin is a second way to say what SQL does. The contract suite holds
  only what it asks.
- **One seeded database for a whole package.** Tests then share rows, and a test can pass on the
  rows of another.
- **Drop the twins of Yjs and files too.** Not decided. A pilot comes first.

## Consequences

- A use-case test keeps its file and its place. Its set-up is async, and foreign keys ask for the
  parent rows.
- Each slice with a database port has a `test-support.ts` of 30 to 70 lines.
- The check refuses a twin and a contract suite of a database port. It has no list.
- The name of the adapter says which rule holds. An adapter of another name that only reads SQLite
  keeps a twin, and a review must catch it.
