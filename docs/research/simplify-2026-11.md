# Simplify: less code behind the same behaviour

Record of the series that started on 2026-11-24, on main 5ff33c00b. The hexagon series
(ADR 40) gave each capability three rings. This series removes what that move left
behind, and what the rings made shallow. Behaviour stays the same.

## What scc measured

The `src/` of the six server packages (`engine`, `devices`, `notifications`, `agents`,
`auth`, `telemetry`), scc 4.1.0. "Before" is 2e3bcc9e6, the parent of the first ring commit.

| What | Before | 5ff33c00b |
| --- | --- | --- |
| Files | 947 | 2,689 |
| Code lines | 202.8k | 265.1k |
| Complexity | 20.9k | 22.7k |
| Test files | 330 | 895 |
| Source files of 25 lines or less | 117 | 579 |

Complexity rose 9%. Files rose 184%. The new lines are mostly use cases (17.3k), twins
(12.2k), wires (9.3k), contract suites and tests (10.8k) and use-case tests (24.4k).

## Candidates

The numbers with "about" come from scripts that match text. A lane measures its own claim
before it changes code, and writes the true number here.

| # | Candidate | Claim | Rule change |
| --- | --- | --- | --- |
| 0 | Remove legacy | Code that only serves a past format, name or caller | `AGENTS.md`, "Only forward" |
| 4 | Retire old tests that have a use-case twin | 113 test titles exist twice | None |
| 2 | One Access seam | 12 slices declare `<Slice>Access` with copied stubs | Generator template |
| 3 | Call the sibling slice | 55 `in-memory-neighbours*.ts` files, 7,159 lines | None (P7 says so) |
| 1 | A use case appears when a decision does | About 81 of 412 use cases forward one port call | Amends ADR 40, decision 3 |
| 5 | A twin only where a use case reads it | Drizzle twins are as large as the real adapters | Narrows ADR 40, decision 7 |
| 6 | A store sits with the requests that use it | Five sub-verticals hold a store and no use case | Section 4, file limit |
| 7 | One request shape from the door to the use case | 119 lambdas map positional arguments | ADR 40, decision 6 |

Order: 0 (inventory), 4, 2, 3, then 1, 5, 6, 7. Each lane starts after the lane before it
is on `main`. A rule change gets a new ADR. ADR 40 stays as written.

## Findings

A lane adds its findings here: the claim, the measured number, what it removed, and what
it kept and why.
