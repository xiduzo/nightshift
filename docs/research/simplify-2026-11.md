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
- Old runs and flow revisions are rewritten once, not deleted. The old readers go after that.
- Nobody reads or copies the database of the Host for this series. The rewrite must be safe
  without a count there.
- The databases and folders from before October stay on disk. Only the code that names them goes.
- A use case decides (ADR 41). Its three new lists are allowed: ignored actors, forwards and
  empty tests. They only get shorter. This is an exception to "never add a line".

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

### F4b. Older tests of auth, devices and notifications (a504e9f5e, e0f674680, c349ef8a5)

- Cases in source: auth 263 to 220, devices 769 to 726, notifications 275 to 274. Lines:
  +732/-2,522. No production code changed. Four test facades with old names are gone.
- 177 mutants: 171 red at once, 6 green. Five were gaps, now closed. One is equivalent.
- Kept whole: placement, merge, split, admission, offers and work. Their ring tests prove
  too little, so these suites are the only integration proof.
- The whole devices suite did not run in the lane. The check of the combined tip runs it.

### G. Guards (a799b726e, bc810c194, ab9c198a4)

- One check, "CI passed", needs the four CI jobs. Nightly and release read it before they
  build or tag. CI also runs on `arch/**`.
- A rule in `check-verticals` fails a relative import that names no file. On 044ca498c it
  finds 36 problems in 23 files. On the tip it finds 0.
- A pre-push hook runs the types and Biome: 14 s warm, 60 s for the types in a new worktree.
- Incident: for 53 seconds `core.bare` was true in the shared Git configuration. A test ran
  `git init` inside a hook and inherited `GIT_DIR`. It is repaired, and the test drops `GIT_*`.
  Other tests that run `git init` are not checked for this fault.
- Gap: `insights-image.yml` does not read the check when a person starts it.

### 3. Call the sibling slice (lane F3: e82d8d0d2, c3973c04c, be739468e, ca2701a86)

- 62 engine ports were classified. 40 are removed, 22 stay. The use cases take the type of
  the sibling. Engine code lines: 170,452 to 170,018. Files: 1,672 to 1,681.
- The claim was high. The 55 neighbour files were counted in all packages. In the engine they
  go from 5,107 to 4,344 lines. "Runs 16" does not hold for ports that runs fills.
- Seven fakes were wrong about the real sibling. None hid a fault of the product.
- 21 mutants on callers: 17 red, 2 more after a test was tightened, and the last 2 after
  280a5e8b3. The first count of 18 was wrong.
- 280a5e8b3 also removes AgentConfig and DeciderConfig, with their casts. 42 ports are now
  removed and 20 stay.
- What stays, and what frees it, is in the ledger of the lane. The main causes are cycles
  (`knowledge/files`, map, secrets) and ports that the wire composes.

### M0. Design of the data rewrite (read only, not built)

- The whole flow upgrader is 684 source lines. The rewrite needs a job, undo files, three
  doors for late rows and a report. The upgrader stays behind those doors after the strict
  release. So the rewrite adds code until a last release that has no date.
- An old row can arrive at any time from a computer that was offline. "Once" is not possible.
- A full database restore on the Host is unsafe: the Walker counts again from a lower number,
  and the peers drop its new events without a message.
- `version < 9` is the wrong test for old data. Some version 9 values also need the migration.
  Without it, a node with `tools: ["github"]` loses the tool without a message.
- D0 said that projects without `folder` disappear. Too strong: the rows stay, but they stop
  following the document, and a new Device gets none.
- The orchestrator advised the rewrite before this design. Now it advises against it. The
  owner has not answered yet, and nothing is built.

### P1d. Who may act moves into the use cases (90483d352 to e6a413346)

- No use case ignores its actor: 51 to 0. The owner of this computer is a port,
  `engine/src/access/computer`. The doors keep their checks, so a rule is asked twice.
- Owner decision: five changes ask the role of the Person also when that Person owns the
  computer: reset a kept value, forget node memory, dismiss a notice, use a project's folder
  and save schedules. A viewer is refused.
- A separate review compared 318 answers of the real daemon before and after (53 procedures,
  6 identities). Five differ, the five above. CI passed.
- Lines go up, as the plan said. The gain is that a rule has one place and a test.
- Next: tests at the daemon for the wiring of the checks. Until then no door check goes.
- The web still offers these five controls to a viewer, who then gets an error message.

### W. Tests for the wiring of the checks, and controls by role (7009aca47, 9cb0a0a9c)

- One table test over the real daemon asks 18 services as a stranger and as the owner. 26 of
  26 mutants on the wiring are red.
- The web disables the five controls for a viewer, with the rule that the flow route uses.
  11 of 12 mutants are red. The last is a dialog that a viewer cannot open.
- Not seen in a browser. New flow, Import, Delete flow, Save in the editor, project Rename,
  Move and Remove, and Copy from GitHub are still enabled for a viewer.

### P1a. Dead code of devices (84f852e3a, 9b0f6ec61, 5b0a22f9a)

- Ten dead forwards and two barrel aliases are gone: 28 files, +9/-247.
- Placement: 35 of 64 mutants stayed green over seven suites. A new test of the use case
  catches 32. Three are left, read as equivalent or not reachable.
- Membership: 48 of 107 mutants stay green over the merge and split suites. Other suites were
  not tried, and some of the 48 are equivalent. Tests come before a change of its shape.
- None of create-placement, create-home-membership, merge-steps and split-steps is a use
  case. The proposed shape: five requests for placement, seven for membership, shared steps
  in `domain/`. Not built.

### FW. The forwards are gone (509afb22b, e74421514, d67a7c453, a36231366)

- 27 of 29 listed use cases and their tests are deleted: 87 files, +374/-1,698. None held a
  check of who may act. Complexity does not change, as the plan said.
- Two of the list were mappings and stay. The three role writes of auth stay.
- About 65 mutants. Four calls that take ids of one type have a case through the real wire.
  Two survive: the bindings of `readRunTrace` and `findTargets` in a wire. No test that
  asserts them was found on the base. Nothing proves that `take` is one document change.
- AskedQuestions stays. It is not as small as lane F3 wrote.

### M. A faster test database (787ae4f26)

- `migratedDb()` builds the schema text from the real migrations once per process. Set-up:
  27.7 ms to 3.6 ms, median. The 84 to 282 ms of the plan was load.
- Contract tests of auth, engine and notifications: CPU -48%, wall -28%. Three full suites by
  CPU: 256 s to 179 s, nearly all in the engine. The wall times are confounded by load.
- A test compares each schema object, row and pragma with a migrated database. Nine faults
  make it fail.
- 14 test files still use the old way. They follow, so that one way is left.

### Continuous integration

- One test of the `flows` command passed the 5 seconds of Bun on a slow runner. Bun then
  stopped the daemon of the file. The limit of that file is now 60 seconds (a301dccad).
