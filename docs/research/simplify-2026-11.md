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

Each entry names its source. "Read" means found by reading and not reproduced.

### The base was red

- Main 044ca498c fails CI. The inventory lists 16 test files that do not load since the
  folder renames in 22507ddcb: devices 8, auth 5, engine 3. They hold about 201 cases,
  including five contract suites. The orchestrator ran some of the auth files and the type check.
- `auth`, `agents` and `daemon` do not type check.
- The web build fails, and settings save and the Ollama download fail at runtime since
  b5d8b7852. It made factory methods into values and dropped `builtinQueries`. The fix is
  aaf607cae (lane A1, not landed yet).
- The "bun" contract suite in `packages/engine/src/agents` runs the in-memory adapter twice.
  The real adapter has no proof there.
- Rule for the series: a test file that does not load proves nothing. A lane reads the
  "Ran N tests" line before it names a surviving test.

### 0. Legacy inventory (lane L0, read only)

- Legacy is about 2-3% of the code lines: about 4.5k source and 6.4k test lines. These are estimates.
  The claim "a lot of legacy" holds for format readers, old-name test facades, peer
  fallbacks and one-time moves. No feature flags were found, and a text search found
  nothing old in `deploy/` or `turbo/`.
- Current formats: flow 9, schedules 3, run bundle 10. The peers have no version handshake,
  so no code can tell that an old peer is gone.
- The "113 titles exist twice" of the candidate table is 182 by a second count. Most are
  sibling use cases that share a title. For old against new, 71 titles are identical.
- The largest items: the Clone folder import, the flow migrations, the older-Host paths.

### 2. One Access seam (lane F2, ec52de096 on `arch/forward`)

- The claim holds: 13 copied ports and stubs, and `KnowledgeAccess`. All are gone.
- The copies existed because importing `runs/access` closed a cycle. It is now
  `packages/engine/src/access`, below the capabilities that use it. No debt line was added.
- The twin runs the real decision. Of the 30 use cases that ask for access, 22 to 24 had no
  test of the role rule. Mutations on all 30 go red now, except equivalent changes.
- Code lines do not fall: engine 182,883 to 182,960. Twins -174, other source -145, tests
  +444. These three were counted before the repair commits. The gain is proof and locality.

### A1. Dead code in the apps (`fwd/dead-apps`, ready, not landed)

- 40 files, +192/-1035 lines. No dependency became unused.
- Kept: `schedulesFileSchema` in `flows`. Only tests and the JSON-schema snapshot use it,
  and it is a format.
