# 41. A use case decides

Status: accepted, 2026-11-24. The checks are built, 2026-11-24, in the forward series. It
amends ADR 40, decisions 3, 5, 6, 7 and 10. ADR 40 stays as written.

## Context

ADR 40 gives each request one use case, one file and one test. Measured with the
TypeScript parser:

| What | On b21eb18f0 | Now |
| --- | --- | --- |
| Use cases | 413 | 379 |
| Use cases that pass their request to one port call | 52 | 6 |
| Use cases whose test asserts only that a function exists | 9 | 3 |
| Types of a port that a use-case file declared | 4 | 0 |
| Contract suites without an `expect` | 0 | 0 |
| In-memory twins that only their contract test reads | not measured | 0 |
| In-memory twins that take code of a real adapter | not measured | 2 |

A use case that forwards has the interface of its port. Its test repeats the contract suite
on the twin. The file does not say that a decision is there. Most forwards serve another
slice or another package.

## Decision

1. **A use case decides.** It decides at least one of these: who may act, a refusal, the
   order of several effects, or a value that a rule of the domain computes.
2. **A forward is no use case.** A function that passes its request to one port call, and
   does nothing else, does not sit in `application/`. The `wire.ts` of the slice gives that
   call. The wire returns a port type or a part of it, never an adapter. The name and the
   request stay when callers in other packages use them.
3. **A call that the door of a person reaches is a use case.** It takes the `Actor` and
   asks who may act, also when it then makes one call.
4. **A use case that takes the `Actor` reads it.** A pure computation takes no actor. The
   API keeps the session and the input schema.
5. **The owner of this computer is a port.** A use case that only the owner may use asks it.
6. **A step with one caller sits in its use case.** A step in `domain/` has two callers.
7. **A test asserts an outcome.** A use-case test that asserts nothing, or only that a
   function exists, fails. So does a contract suite without an `expect`.
8. **A twin has a reader.** An own port has an in-memory twin when a use case reads the
   port. A twin that only its contract test imports goes, and the suite runs on the real
   adapter alone. A twin takes no code of a real adapter.
9. **A port sits in `ports.ts`.** A use-case file declares no port type of its own.
10. **The ring check (H6, H7) holds rules 2, 4, 7, 8 and 9.** It reads the syntax tree.
    `scripts/use-case-debt.txt` names the files that broke rule 2, 7 or 8 on the day the
    check started. Rules 4 and 9, and the suites, have no list. A new check may start with
    a list that is filled on its first day, with the yes of the owner. After that day, the
    list gets no line.

## Alternatives

- **Decide by the caller.** A use case exists when a door calls it. A check must then
  follow calls through every wire. The decisions of calls in the process lose their test.
- **No twin for a store of SQL.** Use-case tests run on libsql in memory. A new database is
  cheap when it starts from the schema text, so time is no reason against it. Each test must
  then seed the rows of other slices. We wait for a pilot.
- **Fail a function in the ports bag too.** 170 places write one there: the clock, a new id,
  another use case. Most are no hidden port, so the check does not ask for it.
- **Keep the rule.** A new forward costs two files.

## Consequences

- A use case that a door reaches keeps its check beside its work. That adds lines.
- A review still judges a mapping: a literal in the call is enough to pass the check.
- The list starts with 11 files: 6 forwards, 3 tests and 2 twins.
- Two ids of one type can swap in a wire. Such a call takes an object, or has a test through
  the wire.
