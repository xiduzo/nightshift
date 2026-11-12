# Architecture series 3: deeper modules

**Status (2026-11-12):** Done. All ten cards landed on `main` in three waves. Card 10
landed its slices 1 and 2. ADR 29 to 34 record the decisions.

On 2026-11-12 the owner ran `/improve-codebase-architecture` on main cd15bda0. The
review found ten candidates and seven smaller findings. The owner then asked Claude Code
to orchestrate the work: research agents check each card, implementation lanes change
the code in their own worktrees, and the orchestrator keeps this record.

This record keeps what the review claimed, what the research found, what the
orchestrator decided, and what landed. The architecture words follow the
`codebase-design` skill: module, interface, implementation, depth, seam, adapter,
leverage, locality.

## 1. Scope

The review read three weeks of commits to find the hot spots:

- the web features `flows`, `runs`, `dashboard`, `gates`, `knowledge` and `agents`
- `packages/client` and `packages/flows`
- the engine's `graph`, `run`, `read` and `log` folders
- `packages/api/src/runs/schemas.ts` and the daemon's `daemon.ts`

It did not repeat the series of 2026-11-05 (Knowledge behind `createKnowledge()`) and
2026-11-06 (Placement, Command, Link, RunState and RunLog, StepShared, Caller, secret
scopes, api procedures).

## 2. How the work runs

1. Three explorer agents walked the hot spots. The orchestrator checked their main
   claims in the code before the report. One claim was wrong and left the report: a
   Gate without an urgency does not fall out of the web inbox, because the api's
   `gateUrgencySchema` always fills the urgency.
2. Each implementation lane worked in its own git worktree. It checked the claims of its
   card first, then designed, implemented and tested. It landed on the integration branch
   `arch/review3` with a fast-forward merge.
3. Three research agents read the code for the later cards (2, 5, 7, 9, 10 and the
   smaller findings) while the first lanes ran. The orchestrator answered their open
   questions before those lanes started.
4. A verify pass ran the CI checks on a fixed integration tip before each push to
   `main`. GitHub CI then ran on `main` again.

In all: 3 explorer agents, 3 research agents, 15 lanes (L1 to L10, X1 to X3, F1 for the
small follow-ups, D1 for the ADRs). Up to 7 lanes ran at once. The lanes' notes stay in
`nightshift-lanes/arch3-*-notes.md` beside the repository, outside it.

Rules for every lane: no flow format change, no change to the wire contract between
Devices and a Host, no db migration, no change to an oRPC route's input or output.

Waves pushed to `main`:

| Wave | Tip | Holds |
|---|---|---|
| 1 | 5f3b0b67 | L3, L4, L5, L6, L8, X1, X2, the first slice of L1, and a merge of main (ADR 28) |
| 2 | d3ebca6d | L9, the second slice of L1, L7 |
| 3 | after aa423265 | L2, L10, X3, F1, ADR 29 to 34, and this record |

The merge of main showed one gap that a merge of lines cannot show: main removed
three routes of a run's copy, and the new change table of L5 still named them. The
types check failed on the integration tip. L5 removed the rows before the push.

## 3. The candidates

| # | Candidate | Strength | Lane | Result |
|---|---|---|---|---|
| 1 | One definition per node type | Strong | L1 | Done |
| 2 | One declaration of the texts a node holds | Strong | L2 | Done |
| 3 | Where a run is and what it needs, decided once | Strong | L3 | Done |
| 4 | The Gate queue and the answer, once for both apps | Strong | L4 | Done |
| 5 | One owner for what a save makes stale | Strong | L5 | Done |
| 6 | The run as an assistant reads it | Strong | L6, X3 | Done |
| 7 | One place a flow is checked in | Strong | L7 | Done |
| 8 | What uses a secret, a Connection, a CLI tool or a profile | Strong | L8 | Done |
| 9 | One climb for every node with a cascade | Worth exploring | L9 | Done |
| 10 | The flow editing session | Worth exploring | L10 | Slices 1 and 2 done, 3 and 4 open |
| B3, B7 | Daemon wiring decisions, one scheduled start | Smaller | X1 | Done |
| C1, C2 | Typed not-found refusals, one harnesses object | Follow-up | X2, X1 | Done |
| | Small follow-ups of the lanes | Follow-up | F1 | See section 5 |
| | ADRs of this series | Docs | D1 | See section 5 |

## 4. Where two copies differed, and the decisions

The review found seven places where two copies of a rule give two answers. The
orchestrator decided each one before the lanes started. A lane keeps today's behaviour
when it finds a stated intent against the decision.

| | Difference | Decision | Outcome |
|---|---|---|---|
| D1 | The Watch tile "Failed" counts failed and interrupted runs. The Runs chip it opens shows failed runs only. | One status-group table. The tile and the chip count the same runs. The docs decide where an interrupted run belongs, else the web Runs list does. | An interrupted run counts as stopped everywhere (ADR 30). |
| D2 | "Running now" is running and sleeping on Home, running and waiting on the phone. | Running and sleeping everywhere. A waiting run counts where the person acts. | Built (ADR 30). |
| D3 | The web inbox sorts by urgency, then age. The phone sorts by urgency, then deadline, then age. | Urgency, then the earliest deadline, then the oldest, in both apps. | Built (ADR 29). |
| D4 | The folder check and the login check do not see an Agent's check command or a Service's commands. | Every command field counts. | Built (ADR 34). |
| D5 | The chat and `nightshift mcp` accept a device id that the editor refuses. The profile permission-mode warning shows only in the editor. | One check at every door. | Built (ADR 33). |
| D6 | A project's Secrets list counts use through a Connection and a CLI tool. This computer's list does not. | One rule for both lists. | Built. |
| D7 | An assistant reads a step's transcript until the stream is silent for 750 ms. | Read the saved transcript complete, with no timer. | Built, also for `nightshift mcp` (ADR 32). |

## 5. What each card found

Each card has what the research found before its lane, then what the lane built.

### Card 1: one definition per node type (lane L1)

- Flows held 27 per-type tables, close to the card's "about 22". All 7 tables the card
  named let a new node type pass in silence. The review missed five more that do:
  `checkNodeWith` (a switch without a value), the Subflow's ended label,
  `missingConnections`, the Connections of `proposal.ts`, and `isOptionNode`.
- Each `nodes/<type>.ts` exports a `NodeDefinition`, and `NODE_DEFINITIONS` in
  `flow/node.ts` lists them. A test checks the registry against the flow schema in both
  directions, so a missing type or fact does not compile or does not pass.
- The definition holds: the label, the family, whether the node stands in for a run,
  the outcomes and their colours, the output fields, the typed and the main output
  field, the check, the secrets, a sample node, the new-node constructors and what a
  new node takes, whether it ends the flow and its ended label, and whether it touches
  a computer. The old tables became lookups into it.
- The engine's `NodeKind` lost `isChosenEnd` and `endedLabel`: `route()`, the kept
  shapes and the Call node read the flows functions. The "change both together" copy in
  `draft/subflow.ts` is gone.
- "Touches a computer" was three copies that answer three questions. The definition
  holds the Offer's question (`touchesDevice`), which `devices` now reads. The policy of
  what an Offer allows stays in `devices`. A comment in `offers.ts` (60f36000) called the
  switch "the Offer's rule, not a fact of each kind". It was written when the only home
  for a fact of each kind was the engine's `NodeKind`. The lane moved the fact with no
  change of behaviour, and the orchestrator accepted it. `works()` stays in the engine,
  and a new engine test checks it against `touchesDevice`.
- The flows root barrel went from 517 to 519 names, not smaller as the card hoped: it
  gained the three functions that the engine and devices now read instead of their
  copies. The nodes barrel went from 214 to 202 names, the draft barrel from 79 to 77.
- No behaviour changed. Table tests pin every fact that moved, and the snapshot of the
  guide skill did not change. Flows tests went from 1,186 to 1,207.

### Card 2: one declaration of the texts a node holds (research)

- Wrong in the card: `rewriteOwnTexts` is 146 lines (340 with its 7 helpers), not 170.
  Agents hold 4 regex finders, not 3 (`outcomeReaders` was missed). Flows keeps 4 lists,
  not 3, and `reads.ts` walks a node's texts two ways (`readsOf`, `nodeReads`).
- Holds: `commandOf` sees 3 of the 7 command fields. The 605-line test exists to keep
  the lists equal. On 12 November, 8 fix commits and 3 test commits touched reads and
  renames.
- D4 holds. The gap is drift, not intent. `commandOf` started on 26 October as the
  field that Suggest fills for a command (ec7be701). The login check took it over on
  30 October, before the Service node existed (31 October) and before
  `commandTemplate` marked all 7 fields (42b2c63c, 4 November). The engine runs all 7
  through `Device.exec`, which gives each command the launchers of the CLI tools.
- Decisions: each node definition declares its texts as positions (data), and one
  walker reads them. Suggest keeps its own 3-field target, renamed `suggestedCommandOf`.
  The checks keep their own walk in this series, guarded by one generic test: the
  validate suite has 184 order-sensitive assertions. Agents read the texts in use, as
  the canvas draws them, not the stale fields too.

### Card 2: the texts a node holds (lane L2)

- Each node definition declares its texts: `texts` lists where it holds templates,
  commands and rules, and `plain` lists its plain-text fields. One walk in
  `nodes/texts.ts` reads them. `rewriteOwnTexts` and its 7 helpers are gone, and
  `draft/refs.ts` went from 568 to 195 lines. Renames, Make subflow, paste and
  `rewriteTemplates` read the declaration. A temporary test compared the old and the
  new walk on every fixture: the same texts, in the same order, byte for byte.
- One test file replaces the 605-line `refs-fields.test.ts`. For each node type, the
  declared texts and plain fields equal the template-capable fields of the schema, as
  sets. One generic guard keeps the check's own walk inside the declaration.
- One reads walk: `readsOf` covers the declared texts, `nodeReads` the texts in use, and
  `flowReads` is on the flows root. The agents' 4 regex finders read `flowReads`.
- `commandOf` is now `suggestedCommandOf`: the command field that Suggest fills.
- Flows tests went from 1,207 to 1,175: 101 runs of the old field test went, 74 new
  tests came. Every test of the 12 November fixes passes unchanged. The new tests fail
  on the old code.
- Behaviour changes:
  - D4: the login warning and the folder warning also cover an Agent's check command
    and a Service's start, ready and stop commands.
  - Make subflow reads rules with the rule parser, not with a pattern. `$$.run.<field>`
    now blocks the Subflow. The text "run.flow" inside a string, or `run.flow` as an
    item's key in a filter, no longer blocks it. A rule that reads a node's `visit` is
    listed under "visit per call". The blocking names come in the order the rule reads
    them.
  - For the assistant's prompts: labels, descriptions, strings in rules and fields a
    node does not use no longer count as reads. `$$.x.data.y` now counts. An input that
    only a rule reads is no longer listed as "not read".

### Card 3: where a run is and what it needs (lane L3)

- The claims held: the "Nothing to do" rule in 7 places, `stream.status ?? run.status`
  5 times, `runActions` at 8 sites, a 154-line `noticeOf` with no test, the Gate a run
  waits at found 3 ways. The status groups were declared 6 or 7 times, not 5.
- Wrong in the card: `runs-list.ts:42` is the phone's list. The web has no status
  chips. "The client interface shrinks by dozens of names" did not hold: the web runs
  feature still imports 65 names, mostly transcript helpers. The phone run screen went
  from 29 to 26. The client root lost 5 names and gained 8.
- `statusOf({ status, result })` in `client/src/runs/status.ts` is the one table: a
  run's word, its look (also "nothing to do"), its group, and whether it ended.
  `groupStatuses` and `groupCounts` read the same table. It replaced the copies in the
  web badge, the run bars, the answered Gates, the phone's look, Home, the Runs chips,
  Watch and the run details.
- `runNow(run, live)` in `client/src/runs/run-now.ts` serves both run screens: the
  status shown (live, or the result of an action on its way), what the run allows and
  why not, the oldest open Gate, and the notice as plain parts. The web's untested
  `noticeOf` is gone, and the panel went from 432 to 275 lines with the same words.
  34 new tests cross the two functions.
- D1 went against a research record, with evidence. `docs/research/mobile.md` says the
  Failed tile and chip count interrupted runs. That record was written before the
  Stopped chip existed. Commit 3d7883d2 then moved interrupted runs under Stopped on
  purpose ("stopped before its work was done"), and the engine's dashboard counts
  `failed` only. So an interrupted run counts under Stopped everywhere. To follow the
  record instead, change one line in `status.ts`, its tests and two tile hints.
- Behaviour changes:
  - The phone's Watch tile "Failed" counts failed runs only. The Stopped tile counts
    stopped and interrupted runs. The tile hints say so.
  - Watch's Running now lists running and asleep runs. Before, it listed running runs
    and runs waiting at a Gate.
  - When one run waits at several Gates at once, the web run page names the oldest open
    Gate, not the newest.

### Card 4: the Gate queue and the answer (lane L4)

- The claims held: 605 phone test lines against 84 on the web, and only 43 of those
  web lines (`ladder.test.ts`) covered these rules.
- `packages/client/src/gates` now holds the urgency words and a Gate's urgency
  (`URGENCY_LABEL`, `urgencyOf`), the one queue order (`gateOrder`), who may answer
  (`mayAnswer`), when an answer may go (`maySend`), the brief as parts (`briefView`),
  and what an answer does and when to confirm (`routeText`, `needsConfirm` and the
  rest). Both apps read the order of the urgencies from `GATE_URGENCIES` in flows.
- Gone: the phone's `shared/urgency/`, `brief-view.ts`, six functions of `gate-view.ts`
  and the order in `needs/queue.ts`. The web's `shared/urgency/urgency.ts` (only the
  marker stays) and `ladderOf`. The apps lost 633 lines and gained 199.
- D3: DESIGN.md §2 and the wiki said "the oldest first in each" for the web. The phone's
  lane chose "the first to close first" (dd259fd9) two minutes before the web's lane
  (58a17e58), in the same revamp. Neither gave a reason, so D3 stands. The lane updated
  both docs. The web switch is one commit (e6f57bde), so one revert undoes it.
- Behaviour changes:
  - Web inbox: inside one urgency, Gates with a deadline come first, the earliest
    first, then the others, the oldest first. Gates that tie keep the Host's order.
  - Phone: after an answer, the next Gate is the next one in queue order, not the
    oldest in the Host's order.
  - Edge cases only: a brief part of spaces only is empty on the web too, and the
    phone's impacts note needs an option that says what it does, as the web's does.
- Kept per app on purpose: which Gates the queue holds (the web inbox shows read-only
  and answer-pending Gates to a viewer, Needs you shows only Gates you may answer), and
  the web sends without a confirm (DESIGN.md §2). The copy stays as it was.

### Card 5: one owner for what a save makes stale (research)

- The numbers hold. The web has 114 `useMutation` and 81 `invalidateQueries` (in 52
  files, 8 of them bulk). There are 10 `synced(kind)` and 15 `runActed` calls (11 web,
  4 phone). The `device` document block in `live/cache.ts` names 7 prefixes, and
  `UNTIL_DOCUMENT` in `api/query-client.ts` names 14. No test compares them.
- A read that a save forgets stays stale for 10 minutes (`DOCUMENT_MS`) and is kept for
  30 minutes (`KEPT_MS`). After 10 minutes, the next mount or window focus reads again.
  An open page with no such trigger stays stale. Before 9b9733d5 this was 1 minute.
- The phone has nothing to move: none of its 6 `invalidateQueries` follows a save.
- The key unknown: yes, the four saves the card named, and 13 other device saves, write
  the `device` document. The daemon then tells the owner, and the live cache reads all
  7 device prefixes. So the four follow-ups that "disagree" are duplicates while the
  stream is live, not bugs.
- Some saves write no document: Personal, project and Space secrets (the Host keeps
  them), `cliTools.signIn`, invitations, kept values and memory, run copies, pairing.
  Their follow-ups stay needed.
- Of the 81 hand invalidations, 38 repeat a read that the stream already does (3 of them
  are awaited and stay as explicit reads), 3 repeat it in part, 30 are still needed, and
  10 follow no save.
- The real stale reads are gaps in the live cache's table, not in the call sites:
  - G1: a flow save does not refresh the lists built from flows: "Used in" and "Used
    by" on the Agents page (10 minutes), the project and Space Secrets lists
    (1 minute), and the sources of the Knowledge page (10 minutes).
  - G2: the kept values and Since-last-run memory of the flow editor stay stale for
    10 minutes after a run. They are not document reads but sit under `["flows"]`.
  - G3: `cliTools.check` and `cliTools.programs` also get the 10-minute time.
  - G4: Personal secrets and invitations stay stale on other tabs and on the Host's
    screens. Only a stream item fixes that, which is a wire change.
- The two lists disagree: the device document reads all of the Connections and
  harnesses, but only their lists get the 10-minute time. So every device write reads
  the mounted checks again, also the MCP connect of the Tool node inspector. A device
  write also records each secret's last use, at most once a minute per secret.
- Decisions: one route table in a client module says what each save writes and what
  each change makes stale. The 10-minute list comes from it, so the two lists cannot
  drift. While the live cache follows the Host, it watches the mutation cache, so a
  save needs no follow-up code at its call site. A test checks that every save route
  of the api has a row. Close G1, G2 and G3 (only `["cliTools","list"]` keeps the
  10-minute time), and read a save's follow-up at once. One hook per save was rejected:
  about 40 shallow hooks. The 91 mutation entries that only rename oRPC options are a
  later lane. G4 and the over-read on device writes need a wire change: later.

### Card 5: what a save makes stale (lane L5)

- One change table in `client/src/changes` says what each change makes stale and what
  each save route writes. The list of reads that stay fresh for 10 minutes comes from
  it. A test checks that every save route of the api has a row, and that no row names a
  read.
- While the live cache follows the Host, it watches the mutation cache, so a save reads
  what its route wrote with no code at its call site, on the phone too. The web
  screens of agents, flows, knowledge, projects, Spaces, devices, settings and
  notifications lost their hand follow-ups.
- 12 hand reads stay on purpose: the resets that are awaited or that follow sign-in,
  joining, merging or leaving a Host, and the account check after a refusal.
- Behaviour changes, each its own commit:
  - G2: kept values and Since-last-run memory no longer stay fresh for 10 minutes. A
    change of a run reads them again.
  - G3: only the CLI tools list stays fresh for 10 minutes. The CLI tool check and the
    programs found read again after a minute.
  - G1: a flow change reads again the lists that say which flows use what (profiles,
    Connections, CLI tools, project and Space secrets), the Knowledge sources, and the
    Knowledge review, whose source tasks come from the flows.
  - G1b, narrower than the research: only a run that ends reads `knowledge.get` again,
    not every change of a run, because that read first reconciles the knowledge folder
    for up to 2 seconds.
  - A save reads what it wrote at once. Of the stream's items for the same change, only
    the first inside 300 ms counts as the save's own echo and is skipped, so another
    person's save in that window is not lost.
  - A failed offer withdraw no longer reads again.
- TECH.md and STRUCTURE.md say the live cache owns what a save makes stale.
- The merge of main removed three routes of a run's copy. The table dropped them
  (214e64b3). Main added no save route.

### Card 6: the run as an assistant reads it (lane L6)

- `runReport` lives once, in the engine's `run-status` entry, the one engine entry that
  client may import. Client passes it on. The CLI's copy `reportOf` is gone.
- `runReading(detail)` in `engine/src/read` gives the called flow each step ran in
  (`flowOf`) and the step a run failed at (`failedStep`). One walk in
  `read/called-flows.ts` serves it and the summary's Subflow runs. The daemon's copy of
  the walk is gone.
- `SpaceEngine.stepTranscript(runId, stepId, signal)` returns the entries and whether
  they are whole, so far, or cut. It reads through the peers' existing `stepEntries`,
  which returns once the transcript is whole, on any Device. No wire change.
- `chatRun` is now a mapping. `lineOf` names all 36 event kinds and ends in a `never`
  check, so a new kind is a compile error, not an empty line.
- D7 holds for the editor chat and Ask why. The CLI (`nightshift mcp`) keeps its read
  with an idle timer, moved to `apps/server`: `runs.watch` has no end mark, so a whole
  read over the api needs a new route.
- Behaviour changes:
  - The daemon reads a failed step's transcript whole, with no idle timer. A 10-second
    bound stays (it was 750 ms idle and 5 seconds in all), because the peers' read
    retries while a Host is away.
  - `get_run` adds one line when the transcript is not whole: the step still runs, or
    Night Shift could not read all of it.
  - The CLI's 5-second bound marks the read as cut instead of staying silent.
  - A step whose parent Call step is missing from the run's detail names no called flow.
    Before, the walk looked it up in the run's own flow. A loop of scopes now ends,
    without the old depth limit of 20.
  - Ask why reads the run once instead of twice.

### X3: a step's transcript over the api (lane X3)

- The new read route `runs.stepTranscript({ runId, stepId })` returns the entries and
  whether they are whole, so far, or cut, from `SpaceEngine.stepTranscript` (6bcfb699).
  It is additive: no other route and nothing of the peer protocol changed. The contract
  test reads every step of a real run through it.
- `get_run` over `nightshift mcp` reads a failed step's transcript whole (b0cd22f8). It
  falls back to the old read with the idle timer when the daemon is older and answers
  the route with a plain 404. A NOT_FOUND the route itself declares (an unknown run or
  step) does not fall back. Tests cover the three paths.
- The route stops a read after 8 seconds and answers what it has, marked cut, because a
  Host that is away can keep the read waiting. 8 seconds is below the 10 seconds that
  `chatRun` waits.

### Card 7: one place a flow is checked in (research)

- Wrong in the card: `proposal.ts` is 168 lines. The folder fact took 5 commits in 5
  workspaces, not 4.
- Missed by the card: the chat and `nightshift mcp` report a false profile error for a
  Device whose profiles this computer cannot know. `docs-reference.ts` is a fifth caller
  of the check. The chat's device words were added in b2862645 and never got the device
  list, so they cannot show.
- D5 holds. Commits ca4a6c9e, a73c4584 and b2916175 all say the assistant checks a flow
  as the editor does.
- Decisions: one place value of six facts (flows, name, devices, Connections, CLI
  tools, folder). The check derives profiles, permission modes and Device ids from it.
  One adapter per runtime fills it: web, daemon, server. Two agent filters stay, each
  with a stated intent: a name the draft already uses is not an error for an agent
  (ca4a6c9e), and Suggest retries only on new errors (b2916175). Suggest gets the Space
  scope, as the chat has. This changes an internal type of the api, not a route.
  `list_profiles` does not show the permission mode: the check warns. No new route.

### Card 7: one place a flow is checked in (lane L7)

- `FlowPlace` in flows `draft/check.ts` holds six raw facts: the flows, the name, the
  Devices, the Connections, the CLI tools and the folder. `checkDraft(flow, words,
  place)` and `proposalIssues(base, proposal, place)` take the place whole. The check
  works out the profiles, their permission modes, the Devices whose profiles this
  computer cannot know, and the Device ids itself.
- One adapter per runtime fills the place: the web editor (`useEditorData`), the daemon
  (`assistant/place.ts`, for the chat and Suggest) and the server's CLI. The docs script
  passes the flows and the name. The web's 7 positional arguments and four option
  types are gone.
- One test pins D5: given one place, the editor's `checkFlow` and the agent's
  `proposalIssues` report the same issues on 10 rows.
- Suggest takes the Space scope, as the chat does. No route changed.
- Behaviour changes:
  - The chat and `nightshift mcp` no longer report a false profile error for a Device
    whose profiles this computer cannot know.
  - The device words work. An unknown Device of a node or of "Runs on" is an error, so
    the assistant cannot propose or save it.
  - A profile's permission-mode warning shows in the chat and `nightshift mcp` too.
  - Suggest checks its answer in the place, and still counts only new errors. For
    example, a prompt that reads an output the called flow does not have goes back.
  - In the chat, a fact that fails to load is left out, as in the editor. The CLI stays
    strict, so "Night Shift is not running" still shows.
- Decision: the agent filter that excuses the names the draft already uses now also
  excuses the Device ids the draft names. The person put them there, so the editor
  shows them, as ca4a6c9e decided for profiles and Connections.

### Card 8: what uses a secret, a Connection, a CLI tool or a profile (lane L8)

- Wrong in the card: 4 of the 5 api call sites pass this Device's id, not 5
  (`cliTools.list` does not). "Fixed 4 times in two weeks" counts only `fix` commits.
  Every change to the rule counts 9 in 10 days.
- D6 holds. `docs/PLAN.md` says the Secrets page counts flows through a Connection, a CLI
  tool or a profile, and that page is this computer's. The computer's list was left out
  only by the scope note of an earlier lane, with no product reason. No ADR, DESIGN.md
  line or wiki page says otherwise.
- `createConfigUse(deps)` in `packages/engine/src/flows/config-use.ts` is the one module.
  The daemon makes it once with this Device's id, the config stores and the Space engine.
  The api gets it as the `configUse` service with four methods (`connections`,
  `cliTools`, `profiles`, `sharedSecrets`). Each of the 5 routes checks access and makes
  one call.
- Gone: `useThroughProfiles`, `cliToolsOfSecrets`, `connectionsInUse`, `cliToolsInUse` and
  `profilesInUse` from the engine barrel, `SpaceEngine.flowUse`, `flowUse` and `FlowUse`
  from the flows barrel, the api's `shared-secret-names.ts`, and `secretUsers`,
  `flowNames` and `unreachable` from the api's secrets file.
- Behaviour changes, on this computer's Secrets list only (one commit, c97d9111, so one
  revert undoes D6):
  - A secret's flows also count the flows that use it through a Connection or a CLI tool
    of this computer, named in the flow or through an Agent Profile.
  - A Connection is covered as a CLI tool is. A missing name that only the Connections
    read covered leaves the list.
  - The check that keeps a CLI tool also counts those flows.
- The project and Space lists did not change.

### Card 9: one climb for every node with a cascade (research)

- The climb preamble is written four times, as the card said (`graph/nodes/call.ts`,
  `agent.ts`, `value.ts`, `decision.ts`). Each caller carries the three duties: the
  cascade values, the climb outputs on every end and the climb spec. Agent and Value
  carry a fourth (Agent's prompt about the try before, Value's `trailData`).
- `cascade.ts` has 18 exports. Four of them are used only inside the file.
- Cascade knowledge sits in 27 engine files (17 with code), not 25.
- The risky table is `LADDER_OF`, not `TIER_BY`. It is a partial table, so a fifth node
  type with a cascade gets no ladder and no error. `read/ladder.ts`'s `TIER_BY` serves
  only logs written before a92952fa.
- What folds: the preamble, the three duties, Call's hand-written climb and the rung
  lookup. What stays in each node: the rule that a tier holds (Agent's check and
  session resume, Decision's confidence, Value's `accept`) and the three person-tier
  shapes. About 80 to 110 lines go, and the exports drop from 18 to about 10. The gain
  is that a node cannot forget a duty, more than the lines.
- The card's "the node kind says which ladder" makes a `graph` to `read` cycle, which
  `check-verticals` refuses. The one exhaustive table goes in `read/ladder.ts`.
- Decision: shape A, a `climbing(...)` wrapper beside the step runner. Shape B (a
  `NodeKind.climb` member) edits the node kinds that lane L1 changes.

### Card 9: one climb (lane L9)

- One wrapper, `climbing(root, ctx, { person, attempt })` in `graph/climb.ts`, replaces
  the four copies of the climb preamble. It could not go in `cascade.ts`: that closes a
  module cycle through the Gate chooser and the step runner.
- The person tier returns a `GateAsk`, so the climb opens the Gate itself and a node
  cannot forget to mark it.
- The step runner owns the three duties: the `{{cascade.*}}` values, `tier` and `tries`
  on every end, and the climb to the next try. The Subflow no longer writes its climb by
  hand. The Value's answer reaches the trail through the end of its body, not a closure.
- What decides that a tier holds stays in each node, as the research said.
- `CASCADE_RUNGS` in `read/ladder.ts` is one exhaustive table. It replaces `LADDER_OF`
  and both `TIER_BY` tables, so a fifth node type with a cascade does not compile
  without its row.
- `cascade.ts` went from 18 exports to 12. Production code is 27 lines shorter: the
  nodes lost 145 lines, which moved into `climb.ts` and the step runner. So the gain is
  locality and safety, not size, as the research expected.
- The stored shapes did not change (`CascadePosition`, `PendingGate.climb: true`). ADR 6
  decisions 9 and 10 hold.
- Tests: one table test runs the climb across the four node types (16 tests), and one
  runs over `CASCADE_RUNGS` (4 cases). Two tests of one node type went: the table covers
  them for all four.
- Behaviour changes:
  - An Agent try whose Device cannot be made ready, or whose own Gate cannot open, now
    ends with `tier` and `tries`, as ADR 6 decision 9 says. Before, it ended with only
    its visit.
  - The other templates of the person tier (the deadline, the brief, an Ask's choices
    and attachments) now fill `{{cascade.*}}` instead of empty text. The validator
    already allowed them there.

### Card 10: the flow editing session (research)

- Wrong in the card: 5 `useRef`, not 4. About 22 branches on what the canvas shows, not
  13. The editor gives 8 context types in 9 providers, not 5. Three of them hold what
  the project offers a flow.
- Decisions: the editing session becomes a module without React, read through
  `useSyncExternalStore` (the repo already uses it twice). No new dependency. This series
  does slices 1 and 2 only: the draft, the history, the selection and the open Section.
  The rest waits until a person can check the editor between landings, because no
  browser here renders the web app. Edits from the chat and Suggest stay whole-flow
  edits and do not join the open Section.

### Card 10: the flow editing session, slices 1 and 2 (lane L10)

- `editor/session/editing-session.ts` is a module without React. It holds the draft
  and its undo history, the merge of one gesture into one undo step, the saved
  snapshot and the dirty flag (still a compare of the JSON), the selection, the open
  Section and the Section made last. Its edits: `edit`, `add` (which joins the open
  Section), `undo`, `redo`, `saved`, `select`, `selectNode`, `openSection`,
  `makeSection` and `settle`.
- `flow-editor.tsx` reads it through `useSyncExternalStore`. No new dependency.
- Gone: `use-draft-history.ts`, `setDraftInOpen`, the effect that repaired the
  selection, the dirty ref and its reset by hand, and 4 of the 5 refs. The five modules
  that took `(draft, setDraft, setSelection)` take the session.
- The research missed a second rule of the open Section, in an effect of
  `editor-canvas.tsx`: a selection outside the open Section shows the whole flow again.
  It judges the state after the render, so a rename or a cut counts by where it ends.
  `session.settle()` keeps that timing: one effect calls it after each render.
- 33 tests cross the session without a render. A review agent that saw only the code
  compared the two versions and found no other difference and the same number of
  renders.
- Behaviour changes, both races with a network call:
  - Create a called flow, then edit while that save runs: the editor now asks before
    you leave. Before, the edit was lost in silence.
  - Pick a kit from another project's flows and leave the Section while it copies: the
    node joins the Section that is open when the copy ends.
- A probable bug, found while the lane pinned today's behaviour: when you undo a node
  that you just added and selected inside an open Section, the canvas showed the whole
  flow again. The orchestrator decided to fix it (4105cce0): the Section stays open,
  with nothing selected. Undo of "Make section" inside an open Section works the same.
  An undo that leaves a selected node outside the open Section still shows the whole
  flow.
- Slices 3 and 4 stay open: one view of what the canvas shows, and one read of what the
  project offers a flow.

### Smaller findings (research)

| | Finding | Research | Decision |
|---|---|---|---|
| B1 | What a test run counts in | Gross counts plus `tests` is on purpose (ad631549, 2560d326). A split needs a new optional route field, and a new phone must keep the subtraction until every Host updates. A net `statuses` makes an older phone subtract twice. | Skip |
| B2 | One start draft for three forms | Only two forms build the same request. The quick run sends an inline flow. The schedule dialog is a fourth builder. The reuse rule of cd15bda0 has no test. | Later |
| B3 | Decisions inside the daemon's wiring | Holds: the private network rule, who hears of a stored document, `usageFacts` (50 lines). The seven late-bound callbacks hold too. No test names any of them. | Do the three decisions (lane X1). The late binding is a later card: it changes the start order under `--hot`. |
| B4 | Reading a stored flow | Holds: 15 call sites, "newer" decided 5 times in 3 wordings, the version stamped 8 times. | Later, with cards 7 and 10 |
| B5 | One walk over called flows | Wrong: 9 sites already share `calledFlowNames`. The kits differ on purpose. | Skip |
| B6 | The words of a transcript event kind | A new kind edits 4 web files, not 6. The real risk is the phone's `default: break`, which drops a new kind in silence. | Skip the shared words. An exhaustive phone fold is later. |
| B7 | What a schedule starts | Holds: three copies (scheduler tick, `runNow`, webhook). | Do (lane X1) |

### Follow-ups from series 2 (research)

| | Follow-up | Research | Decision |
|---|---|---|---|
| C1 | Raw `ORPCError("NOT_FOUND")` | Exactly 4 sites. None reaches a Device: they serve screens, and a Host's peer routes turn every refusal into BAD_REQUEST with its kind. A typed refusal leaves the wire the same. The peer contract still declares a NOT_FOUND for `link.removePhone` that no Host throws since 91754a46. | Do the 4 sites after lane L8. Leave the peer contract: it is a contract edit for no behaviour. |
| C2 | Four harness members of `localDevice` | Holds. "The harness of that name" is written twice (engine and daemon). | Do (lane X1): one `Harnesses` object, two adapters (daemon, testing). |
| C3 | "Where this run is walked" from the row | The row is the indexed projection that `WalkerMoved` moves in the same batch. `runsArriving` is a set query and stays SQL. | Skip, unless a bug shows the row and the log disagree. |

### B3, B7 and C2: the daemon's wiring (lane X1)

- C2 (34f32e47): `localDevice` takes one `Harnesses` object with `get(name, use?)` and
  `names()`. It has two adapters: the daemon's `localHarnesses`, which reads the Agents
  page list and the custom agents once, and `harnessesOf(record)` for tests. "The
  harness of that name" is now written once. The 46 test files that pass a record of
  harnesses did not change.
- B3 (74dfe8b8): `daemon.ts` keeps one call for each of three decisions and went from
  969 to 914 lines. `reachesPrivateNetwork` sits beside its setting in the engine,
  `documentAudience` in the daemon's notifications (tested per document kind against
  real synced documents), and `usageFacts` in the daemon's telemetry (tested on a
  database).
- B7 (05d698bf): one `scheduledStart` in the engine's schedules folder builds what a
  scheduler tick, "Run now" and a webhook start. The trigger, the due time and the
  failure handling stay with each caller. Its tests also pin a schedule's base branch,
  which nothing tested before. The research's claim that a test covered it was wrong.
- No behaviour changed.

### C1: typed not-found refusals (lane X2)

- The 4 raw `ORPCError("NOT_FOUND")` throws are now `new Refusal("not-found", ...)`
  with the same words, as `projects/project-space.ts` already did (f6403646).
- The wire did not change. None of the 4 is a Host contract procedure, so no Device can
  read one as an older Host. The daemon's handlers turn the refusal back into
  NOT_FOUND (404) with the same message, and the JSON on the wire never holds the
  cause. The new table test in `procedures.test.ts` pins both the JSON and the refusal
  kind. Run against the old sources, it failed only at the kind.

### Small follow-ups (lane F1) and the ADRs (lane D1)

- F1, five commits, each with a test that fails on the old code:
  - `undeclaredNames` no longer names `cascade` for a node with a cascade (a4d30d2c).
  - The schedules nudge uses the client's `isMissingOnHost`, the stricter of two equal
    rules. `isUnknownProcedure` is gone (0afffcd3).
  - The web's row of sleeping runs and the phone's row of a stopped run read
    `runNow(run).allows`. `runActions` left the client root. `walkerName` lives once in
    client, not three times (877fd9b8).
  - The lock screen, the Dynamic Island, the Android notification and the widgets say
    "Nothing to do" for a run that ended with nothing to do, not "Finished" (6492a933).
  - The engine's `open.running` counts running and asleep runs, as D2 says. Only the
    phone reads it. A phone of build 6 or older shows a count that includes asleep runs
    (aa423265).
- D1 wrote ADR 29 to 34 (3270c35c) and made STRUCTURE.md, TECH.md and the glossary follow
  them (ea82d57b). L8 and L9 got no ADR: the rule of L8 is stated in PLAN.md,
  STRUCTURE.md, DESIGN.md, the glossary and a test, and ADR 6 already says what L9
  built.

## 6. Deep already, left as is

- `validateFlow(flow, { flows, name })`: 3,197 test lines cross it.
- `template/rule.ts`: the one parser of what a rule reads.
- `planSubflowFromSection`: 1,368 lines behind one function.
- The live cache and `useLiveRun`: real seams with two adapters each.
- `NodeKind` and `runStep`: one shape per node type in the engine.
- `ladderOf(steps)`: the three Subflow fixes landed in one file.
- Starting a run: one path for a person, a schedule, a webhook and the Host.
- The Gate brief (`graph/gate-brief.ts`): one owner.
- The Device seam: local and remote adapters.
- `SpaceEngine` and `Engine`: the api router is a thin table over them.

Not proposed: the root barrels change most often (flows 517 names, client 311, engine
155). STRUCTURE §3 and §7 decide their shape. Candidates 1 to 4 make them smaller.

## 7. The ADRs of this series

- ADR 29: The Gate queue has one order.
- ADR 30: A run counts in one group.
- ADR 31: The live cache owns what a save makes stale.
- ADR 32: A step's transcript is read whole.
- ADR 33: One place a flow is checked in.
- ADR 34: A node type has one definition.

Card 8 (one "used by" rule) and card 9 (one climb) got no ADR. PLAN.md, STRUCTURE.md,
DESIGN.md, the glossary and a test state the rule of card 8. ADR 6 already says what
card 9 built.

## 8. What the measurements changed

- Of the ten cards, every one held in its main claim. Most counts in the cards were
  close, and some were wrong in detail: see each lane above.
- Four claims were wrong enough to change a plan: B5 (9 sites already share one walk of
  called flows), B1 (the gross counts of a test run are on purpose), the four "callers
  that disagree" of card 5 (duplicates of the stream's read, not bugs), and card 9's
  "the node kind says which ladder" (it makes an import cycle).
- The size of a change was not its gain. Card 9 removed only 27 lines of production
  code, and the flows barrel grew by 2 names in card 1. Both gained locality: a new
  node type or a new cascade node is now a compile error where it was a silent gap.

## 9. Follow-ups

- L4: `waitingForYou` (the web tab badge and the glance) counts Gates whose answer is on
  its way, and `mayAnswer` does not. Making them agree is a product decision.
- L4: the web run page's answer buttons (`gate-answer.tsx`, `gate-confirmation.tsx`)
  keep their own "needs a note" rule.
- L4: the two apps word the same facts differently (the web toast and the phone's
  `sentText`, the two "Night Shift wrote" notes). One copy decision aligns them.
- L2: the check could read the text declaration itself (question Q2.2 of the
  research), once the order-sensitive validate tests allow it.
- L2: `plain` has no reader outside its schema test.
- L1: a `connections` fact in the definition would remove three copies (draft,
  proposal, engine). The copies disagree on a Tool node with an empty Connection, so
  it needs a decision first.
- L1: an `options` fact would cover `isOptionNode` and `withOptions`, and the outcome
  colours could come from it.
- L1: the server test `live-transcripts.test.ts` timed out under load and passed alone
  (the known pairing flake).
- L7: watch real chats. An agent that guesses a Device id now sees its proposal
  refused.
- L7: Suggest reads the Devices and the flows before its session, one more Host round
  trip in a hosted Space.
- L7: Suggest's work folder lookup still passes no Space.
- X3: "the other side does not have this route" is decided three times: the client's
  `isMissingOnHost`, the client's `isUnknownProcedure` in `schedules/nudges.ts` (it
  could call `isMissingOnHost`), and the CLI's `isMissingRoute`. No module that both the
  client and the server may import holds it today.
- X3: the route's 8-second limit is tied to the 10 seconds of `chatRun` only by a
  comment.
- X3: the CLI's fallback read and its wall-clock test can go once no CLI talks to a
  daemon without the route.
- L8: ADR 18 decision 4 says a Space secret wins over a project secret of the same name.
  A project's Secrets list still names flows that read the Space's value.
- L8: the Connections page "Test" reads this computer's value only, so a hidden missing
  name can still make a test fail there. CLI tools have the same trade-off.
- L6: the web keeps `flowOfStep`: no view names the called flow of a step.
- L6: a step that still runs on another Device gives no transcript lines, because this
  computer keeps none of it until it ends.
- L6: the CLI's `get_run` reads every `runs.get` error as "no run", also when Night
  Shift is not running.
- L5: a project move or remove now reads the Space queries twice.
- L5: nothing stops a hand read coming back. A check that allows `invalidateQueries`
  only in listed files would.
- L5: the 91 mutation entries that only rename oRPC options are still there.
- L9: when a person answers "try again" at the person tier and the daemon stops before
  that answer is saved, the next start routes on `try-again` instead of climbing. The
  new `doneAndGo` could fix it.
- L9: an Agent's own ask Gate inside a try still routes without climbing. ADR 6 does
  not say whether it should.
- X1: the seven late-bound callbacks of `daemon.ts` need their own card: their start
  order matters under `bun --hot`.
- X1: `daemon.ts` writes the usage snapshot type by hand, because `@nightshift/telemetry`
  does not export `UsageSnapshot`.
- X2: 6 more raw `ORPCError` throws in api handlers send the same bytes as a refusal
  would: BAD_REQUEST in `config/connections.ts` (2), FORBIDDEN in `projects/router.ts`,
  `devices/account.ts`, `devices/router.ts` and `ownerOnly` in `procedures.ts`. Check how
  the screens read FORBIDDEN first.
