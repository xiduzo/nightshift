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

### Decisions of the owner, 2026-11-24

- No older versions stay: no old Host, Device, desktop, phone build, flow file, run bundle
  or `.nightshift/` folder. Data that the new code cannot read is removed, so that nothing
  downstream breaks.
- CI becomes a requirement on main. A type check runs before a push, and a check resolves
  every relative import.

### A0 and F4a, landed on `arch/forward`

- A0: each red cause traces to one commit: f161cb1be (first red CI), 22507ddcb (imports),
  7e200b30d (defaults of a facade dropped), 3d306043b, ba5310a6a (assistant tools, four test
  files deleted), 5ff33c00b and b5d8b7852. The product faults are fixed. Those of them with
  a test that was red before are in the commit messages.
- How it got through: the pre-commit hook runs no types and no tests, main has no
  protection, and 13 pushes followed a red CI. The nightly build does not wait for CI.
- F4a: 61 same titles, not 62. 420 lines added and 2,998 removed in 45 test files. 141 cases
  fewer. Of 51 valid mutants, the survivors caught all but three at first: one equivalent,
  one gap that is now tested, and one same title over a different function (case restored).
- The whole engine suite is not measurably faster: 642 s against 631 s, within noise. The
  time is in real git and graph walks. So candidate 4 is worth its lines, not its seconds.

### AG. Proof for the assistant and the agents (b21eb18f0)

- Production lines of the assistant: 5,245 to 5,016. A comparison of 1,035 prompt and tool
  records before and after is byte-identical.
- Two gaps in H7: a contract suite without `expect()` passes, and a twin may import the real
  adapter. A port type that sits in a use-case file escapes H7.

### D0. Old data (read only, one computer)

- Most runs and flow revisions in the store that was counted hold an old flow format. In a
  dry run on a copy, all of them migrated with no failure.
- Project data without the `folder` field must be filled before its default goes. Without
  that, those projects disappear.
- Not counted: the Host and other computers. Removals that touch data wait for the owner.

### P1. Plan for candidates 1 and 5 (read only, b21eb18f0)

- Candidate 1 is worth less than half of its claim. Of 413 use cases, 52 forward one port
  call and 20 forward after a fixed mapping. The table says about 81.
- 32 forwards can go (64 files, 1,541 lines). 10 more in devices are dead today (20 files,
  202 lines). With the rule lines added, about 1,580 lines go. Complexity does not fall.
- 43 files in `domain/` are async, not 55. Most are the shared steps that P2 asks for.
- Candidate 5 is worth almost nothing as titled. Of 88 own ports, 2 have no reader beside
  forwards. Lane F3 gives the twins more readers. It becomes a check, not a lane.
- The time is in the migrations. `createDb` and `migrateDb` took 84 to 282 ms for each case,
  and a schema text took 3.4 to 6.1 ms. The machine was loaded: the ratio holds, the times do
  not. 216 cases pay this. The journal, the FTS tables and the seed rows are not checked yet.
- Nine use-case tests assert only that a function exists. Four of them sit beside 1,526
  lines in devices placement and membership. Tests in other places were not checked.
