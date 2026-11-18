# 40. A capability has three rings

Status: accepted, 2026-11-18. The rules, their checks and their debt lists are built,
2026-11-18, in the hexagon series, phase 0 (73561423 to 3353f49f). The code moves into
shape in phases 1 to 4.

## Context

Night Shift had the outside of a hexagon, and not the inside.

The outside was in place. The packages sit in layers and import only downward
(STRUCTURE.md, section 1). A lower package declares a port when it must call a higher
one, and about 30 ports exist. The API is thin: a procedure checks the input and the
access, and calls one domain function.

The inside of a server package had no rule. One function could hold a rule of the
product, a query and a call to git. Measured on main 9775e6a3, on 2026-11-18:

| What | Number |
| --- | --- |
| Engine functions that take the database handle (`db: Database`) | 63 |
| Drizzle statements in the engine | about 201, in 37 files |
| Engine test files that need a database, a folder or a process | 130 of 202 |
| The same for the eight packages on the server side | 229 of 369 |
| Source files over 600 lines | 57 (25 in the engine, 12 in the web app) |
| Folders with more than 25 source files | 9 |
| Verticals over 5,000 lines | 9 |
| Barrels with more than 30 names | 21 |
| Verticals that import more than 5 other verticals | 16 (the engine's `run`: 21) |
| Web verticals with kind folders (`components/`, `hooks/`, `lib/`) | 4 |
| Peer ports | 9 |

So a test of one rule started a database. The longest file had 1,470 lines. No list said
which vertical is a product area and which is shared machinery. The size limits of
STRUCTURE.md were signals, and nothing checked them.

## Decision

1. **The packages stay.** A package is one bounded context and keeps its layer. The
   rings go inside each capability of a server package: `engine`, `devices`,
   `notifications`, `agents`, `auth` and `telemetry`. `api` stays the driving adapter
   for people. The apps get no rings, only the vertical rules.
2. **A capability is a slice with three rings.** `domain/` holds the rules as pure
   TypeScript. `application/` holds the use cases and the ports they ask for.
   `adapters/out/` holds the code that touches a database, a folder, a process or the
   network. Imports point inward: `adapters/` to `application/` to `domain/`. The slice
   has a barrel (`index.ts`) and a `wire.ts`, and nothing else beside its tests.
3. **One request is one use case.** A use case is one file with one exported function
   and one test file beside it. It takes its ports as its first argument. Its test runs
   on in-memory adapters and starts no database, folder or process.
4. **A use case throws a `Refusal`** for an expected outcome. Every package already
   throws it, and the API gives each kind its status in one place.
5. **The use case decides who may act.** It takes the `Actor`. The API keeps the session
   check and the input schema.
6. **Only a `wire.ts` builds a real adapter.** `wire<Slice>(deps)` builds the real
   adapters of its slice and returns the use cases bound to their ports. The barrel
   exports that function and types, never a store. `Engine` and `SpaceEngine` stay as
   thin objects that list the use cases, so the API's `Services` keeps its shape.
7. **Every driven port has an in-memory twin and one contract suite.** The twin sits
   beside the real adapter. The suite runs on both, so the twin cannot drift. A store
   port is narrow and belongs to one slice (`ScheduleStore`).
8. **One capability map names every vertical.** `scripts/capabilities.ts` is typed data.
   It says of each vertical whether it is a capability, a mechanism or the wiring. A
   capability has one folder name in every workspace. A mechanism imports no capability.
   A capability imports at most five others.
9. **The size limits are hard limits.** A source file has at most 600 lines. A folder
   holds at most 25 source files. A barrel holds at most 30 names of its own. A vertical
   over 25 source files or 5,000 lines consists of sub-verticals. A vertical holds no
   kind folder. No new peer port.
10. **Each rule is a ratchet with a debt list.** The list names what broke the rule on
    the day the rule started. A new offender fails. A listed line fails once its code is
    clean. So a list only gets shorter. The model is `scripts/check-time.ts` with
    `scripts/time-debt.txt`.
11. **Behaviour stays the same.** The series moves and reshapes code. It changes no rule
    of the product, no wire format, no flow format, no database schema and no UI copy.
12. **The rules come first.** Phase 0 lands the checks, the map, the debt lists and the
    docs. Phase 1 is the pilot, `schedules`. Phase 2 is the run path. Phase 3 is the
    stores. Phase 4 splits the big verticals.

STRUCTURE.md holds the rules: section 4 for the verticals, section 9 for the rings.

## Alternatives

- **One backend app with `features/`.** Merge the server packages into one app and cut
  it by feature. Then nothing enforces the layers. Bun links only the packages that a
  workspace declares, and `tsc` refuses an entry that `exports` does not name. A folder
  rule gives neither.
  `client` and both apps also read package entries (`engine/run-status`,
  `notifications/contract`), so every import path would change at once.
- **A `Result` type.** A use case returns the refusal as a value. But every package
  throws `Refusal` today, and the API maps it in one place (`readable`). A `Result` type
  would be a second way to refuse, and every caller would unwrap it.
- **A port for the whole database.** One `Database` port serves every slice. Its twin
  would be a second database. A narrow port names what one slice asks, and its twin is a
  small object in memory.
- **A custom script for the import rules.** The file rules, the debt list and the rule
  that reads the capability map are a script. The import rules are dependency-cruiser's.
  It resolves a Bun workspace through `exports`, knows `bun:*` and marks type-only
  imports. A maintained library is the better choice when it does the job.

## Consequences

- A use-case test needs no database. The pilot measures the lines and the seconds.
- A slice has more files. One port of its own brings four files in `adapters/out/`: the
  real adapter, the twin, the contract suite and the test that runs the suite.
- On the day of the decision, 72 verticals of the server packages exist. 39 are
  mechanisms, 33 are on `scripts/hexagon-debt.txt`, and none is in shape.
- A listed file, folder or barrel cannot grow. A change that must add to a listed file
  splits it first. That slows work on 57 files until phase 4 splits them.
- Nothing stops a person who adds a line to a debt list. A review must catch it.
- dependency-cruiser 18.8 cannot use the compiler API of TypeScript 7.0, so swc reads
  the files. swc does not report a type written as `import("x").Name`. A small module
  fails that form where a rule applies. TypeScript 7.1 makes both unnecessary.
- Biome keeps `Bun`, `fetch` and `process` out of `domain/` and `application/`. It does
  not catch `globalThis.fetch`.
- No check reads the arguments of a use case, or what a driving adapter does with its
  input. A review holds those rules.
- A generator for a slice, a use case and an adapter follows the pilot.
