# Any domain: one loop for any work

**Status (2026-11-11):** Wave 0 is in progress: this record,
[ADR 22](../adr/0022-a-project-folder-is-optional.md),
[ADR 23](../adr/0023-foundational-means-no-integration-settings.md) and one copy
pass over the docs and the UI. Waves 1 to 3 have not started. "Progress" lists
each lane and where it landed.

On 2026-11-11 the owner and the orchestrator aligned on what Night Shift is now.
The orchestrator asked 44 questions, and the owner answered each one. This record
keeps the questions, the answers, the order of work and what the lanes find.

The docs and the product still read as a tool for developers whose flows end in
pull requests. Night Shift has outgrown that. It is closer to n8n and Zapier, with
low-level control. A flow can be a software factory, market research with updates
or lead generation. Flows lean on autonomous agents (Claude Code, Codex, pi) and on
deciders: rules, small decision models such as TypeSafe Jev, and big models.

The goal is the person out of the loop. The person engineers the loop. The person
is also its last fallback and its approver, through the inbox.

## 1. What the research found

Three research agents read the docs and the code on 2026-11-11, before the
questions.

- The opening lines already fit: "Stop babysitting your agents", the two ladders,
  "you are the last rung".
- Below them, nearly everything assumed software work:
  - PLAN §1 said "a flow builder for people who work with coding agents". PLAN §2
    said "Users: one developer: the author".
  - The only actor in the glossary was "Developer". VISION said "Code comes first".
  - `npm test` checked the first run. The hero flow is `watch-logs`.
  - 4 of 7 starters build and commit code. Both community flows do GitHub or Jira
    work, and so does every kit but the knowledge kits. 7 of 8 Ideas are GitHub
    work.
  - The built-in scores were `pr_merged`, `pr_useful` and `reverted_within_7d`.
    The repository topics were `coding-agents`, `developer-tools` and
    `human-in-the-loop`.
- Every Idea ended with "A Gate shows you…", so the person reviewed every result.
  Get started said "watch the run".
- The project is a hard limit:
  - Every run creates a git worktree and a branch (`run-start.ts`).
  - A run refuses a project that is not a git repository with a first commit.
  - Schedules run on the Host, and the Host copies only GitHub projects.
  - The cleanup keeps run copies with uncommitted work.
  - A flow cannot exist without a project (`run.projectId` is not null).
  - Each node says whether it needs the project copy (`works()`). Run start still
    creates a worktree every time.
- The real work outside code today is one private research lab that paper-trades.
  No flow for lead generation exists.
- Telemetry:
  - The OpenTelemetry export holds cost, tokens, durations, retries, Gate wait, run
    outcome, scores and `nightshift.pr.outcome`.
  - Anonymous usage events feed Insights. Its funnel ends at "pull request merged".
  - The app shows Runs, Finished, Spend and Gates asked, and Flow health.
  - Nothing counts attention. Take-overs are not logged. Each step records its
    cascade tier, but nothing adds the tiers up.
- TouchDesigner (docs.derivative.ca):
  - Operators come in families by data type: TOP for images, CHOP for channels, SOP
    and POP for geometry, DAT for text and tables, MAT for shaders, COMP for
    containers.
  - Wires connect operators of one family. "X to Y" operators convert between
    families.
  - It grows through components (`.tox` files, custom parameters, the Palette) and
    one Script operator per family.
  - The OP Create dialog groups operators by family and has search. Every operator
    has a viewer.
  - Night Shift's edges carry outcomes, not data. Data travels by templates. So
    families by role fit Night Shift better, with the data type as a second layer on
    output fields.

## 2. The decisions

"Recommended" is the orchestrator's proposal. "Owner" is the owner's answer, in
their own words where they gave words. Where the owner chose another option, the
answer says what holds. These answers are settled: the lanes build them and do not
reopen them.

### 2.1 Identity and people

| Q | Question | Recommended | Owner |
| --- | --- | --- | --- |
| 1 | What Night Shift is | A: domain-neutral. Code is one domain among research, monitoring, outreach, ops and content. "Code comes first" retires. | A |
| 2 | Who the reader is | A: a technical loop engineer in any domain | B, also people who are not technical: "I like the builder mental model from A, but in this day and age anyone can be a builder, especially with Night Shift!" The actor "Developer" becomes **Builder**, with no technical precondition. Low-level control stays one click away. |
| 3 | The person out of the loop as the north star | Yes. Night Shift measures attention next to cost. A new VISION principle says so. The repository topic `human-in-the-loop` becomes `human-on-the-loop`. | Yes |
| 4 | What a Gate is for | Two jobs. **Fallback:** the ladder ran out, the confidence is low, or a cascade reached its last tier. **Approval:** a person before an act that cannot be undone (send, trade, publish, merge). Every choice climbs rule → decider → you by default. Examples, starters and Ideas stop putting a Gate on every result. An approval Gate can sit behind a cascade (ADR 6). | "yes!" |
| 5 | n8n and Zapier as the reference | B: name the category in the first lines of the README, never with "vs". One honest line: no app catalog, a flow reaches apps through CLIs, HTTP, webhooks and the agent's own tools. "Use them together" stays. | B |
| 8 | What the docs may claim | Name domains as examples of what a flow can be. Claim only what runs or can be opened. No invented user stories, results or measurements. | Yes |
| 11 | Whether the hero speaks to anyone | B: lead with a line about the result | A: keep "Stop babysitting your agents", "but all other texts should be updated/tuned" |
| 12 | How a person gets an agent | Agents stay harness CLIs. A guided setup installs one agent CLI and signs you in, with no terminal, like "Set up git". | "YES!!!" |
| 13 | How a person makes a flow | Two doors to one flow. "Describe it" (the assistant drafts it) comes first, "draw it" (the canvas) second. Technical fields keep their syntax and get a plain door: a picker, Suggest. | "sure" |
| 22 | Whether Night Shift sets up a decider too | Yes: Local (Ollama, no account) or TypeSafe Jev (a key). Without a key, Local is the default. | Yes |
| 23 | Signing the Mac app | Sign and notarize it before Night Shift invites anyone | "yeah, but for now in testing ourselves it works okay". Signing comes before outside users. Unsigned is fine while the team tests. |
| 24 | Windows | Out of scope | Yes |
| 25 | Who answers a Gate | One actor: the Builder answers their own Gates | "anyone within the Space gets the inbox and can answer, mostly based on the roles from Better Auth". Every Member answers by role (`gate: resolve`: owner, admin and member yes, viewer no). The code already does this. |
| 26 | A narrower approver role | Wait for a real need. An `approver` role and a Gate for one person wait for a real shared Space. | Yes |
| 28 | How Builders share flows | A: `community/` (flows shared by pull request into this repository) stays. The wiki adds the plain path: "export the flow file and send it". A gallery comes later. | A, after a clarification of what `community/` is |

### 2.2 Projects and runs

| Q | Question | Recommended | Owner |
| --- | --- | --- | --- |
| 7 | Whether a project stays a git folder | A: keep git as the substrate, with new words | C, flows without a project: "I would even argue C is the way to go?" Q9 refines it. |
| 9 | What "no project" looks like | C-prime: the project stays the container of flows, schedules, knowledge, secrets and runs. Its folder becomes optional. A project without a folder needs no copy on a Host, so its schedules run there without a GitHub remote. ADR 2 stays. | C-prime ([ADR 22](../adr/0022-a-project-folder-is-optional.md)) |
| 10 | Where a run without a folder works | In its own empty folder in Night Shift's data folder. Its files are the run's files, on the run page, and go after N days. Kept variables and knowledge last between runs. | "yeah" |
| 27 | What a bound folder is | Always a git folder. Night Shift sets git up and hides it: "Night Shift keeps the history of this folder". | Yes |
| 15 | Where the results of a flow go | B: a report on the run page and on Home, never pushed | "yea, no digest indeed" |
| 21 | The shape of a report | An End node gets an optional Markdown report, or a file the run wrote. It shows on the run page, on the flow's card and on Home ("Latest reports" under the lanes). It is never pushed. The rule of Home becomes "what needs me, and what came out". | Yes |

### 2.3 Nodes and editor

| Q | Question | Recommended | Owner |
| --- | --- | --- | --- |
| 6 | Integrations | Stay foundational. Generic kits come before more GitHub kits. | "yes!" |
| 14 | Which generic kits come first | Send a message, call an API, only what is new | Yes: "I want to build more nodes similar to how TouchDesigner expands from TOP, CHOP, DAT, etc. (do some research into this!)" |
| 35 | How nodes group | Families by role, with the data type as a second layer (shapes) | "yeah! I think wait can even be in the hold or should get merged into an overarching one" |
| 36 | Where "foundational" draws the line | HTTP may be a node. Never a vendor node. A kit becomes a native node only on a named failure: memory per caller, a step on a Host with no shell, a secret that would become shell text, or typed output. | "sure — with foundational I mean anything that does not need any explicit 'old school' integration settings. A CLI or MCP are also foundational, like bash or HTTP or webhooks" ([ADR 23](../adr/0023-foundational-means-no-integration-settings.md)) |
| 37 | The first new nodes | **Web request**, **Since last run** and **Convert**. Kits on top: Send message, Read a feed, Send email. "Wait for a URL" is a new kind of Wait. Filter, Pick fields, Sort, Limit and Remove duplicates are one-click presets of a Value by rule. | "yeah babyyyy" |
| 38 | A Notify node | No | "yeah, this is why the inbox now also has an urgency that determines if we make a notify out of something or if it's just something that could be looked at whenever" |
| 39 | Editor ideas from TouchDesigner | In this order: an add-node dialog by family with search (Tab or a double-click, kits under their family, "My kits") and a family tint on icons. Then a viewer on every node (its last output, samples in the template picker) and dotted data links for template references. Then Lock and Bypass for tests. | "yeah let's go" |
| 40 | Whether the output of every node is typed | Yes. Every new native node declares its output schema. A Command gets an optional output schema. Flow outputs get types. | "yup, typed output should be the default so we know what to work with for the next node!" |
| 41 | The families | Wait joins Hold. **Do:** Agent, Command, Tool, Web request. **Decide:** Decision and Gate. **Shape:** Value, Since last run, Convert. **Hold:** Wait, Lease, Service. **Compose:** Subflow, Join, End. Knowledge is a group of kits. An output field gets a shape: text, number, yes/no, list, record or file. | Yes |
| 42 | How typed by default stays easy | Without a schema, Night Shift infers one from the first real output or from a Suggest. A person can edit it, and the node keeps it. A template path that the shape lacks is a warning in the editor. A run fails on a mismatch only for a schema that a person wrote or confirmed. | "yup" |

### 2.4 Metrics

| Q | Question | Recommended | Owner |
| --- | --- | --- | --- |
| 17 | What Night Shift counts | Attention. Value stops being a pull request. | "yeah, and let's expand upon the metrics we already ship with our telemetry and perhaps make it more generically approachable!" |
| 29 | When a run was worth it | "Was this run useful?" on every finished run, on the web and the phone. Cost per useful result replaces cost per merged pull request. The `pr_*` scores stay as an optional scorer for code. The Insights funnel ends at finished → useful. | Yes |
| 30 | How attention shows | "Needed you: N% of runs" replaces "Gates asked" in the strip of four numbers (Home, the project page). A run needed you when a person answered a Gate or an Ask, resumed it, stopped it or took it over. Flow health gets a Needed you column with the reasons. Take-overs are logged. | Yes |
| 31 | Where the work landed | It leads Flow health. Work: the share and cost of each cascade tier. Choices: the share by rule, by decider and by you, and how often a decider fell below `minConfidence`. Also in OpenTelemetry (`nightshift.ladder.rung`) and the usage events. | Yes |
| 32 | Scores | They grow into flow metrics. Any step reports named numbers. Flow health charts them. OpenTelemetry exports `nightshift.flow.metric{name}`. | Yes |
| 33 | One vocabulary | One plain vocabulary in the app, the OpenTelemetry registry and the usage events. Names about pull requests leave the registry: `nightshift.pr.outcome` becomes a `nightshift.score`. The `flow.starter` enum is generated again. | Yes |
| 34 | Days or nights | Ranges and numbers per period count days (midnight to midnight, local time), not nights (noon to noon). "Night" stays in the brand and the hero only. | Yes |

### 2.5 Docs and order

| Q | Question | Recommended | Owner |
| --- | --- | --- | --- |
| 16 | The first starter that is not about code | `watch-topic`, then `find-leads` | Deferred: "let's figure this out later" |
| 18 | A copy pass | One copy pass over every surface now. Fix what is already untrue or too narrow. VISION and PLAN carry the direction as goals. README and wiki describe each new piece only when it ships. | Yes |
| 19 | The Ideas page | It spans domains: research, monitoring, outreach, ops, content and code. Each idea climbs the ladder first (rule → decider → agent). An approval Gate comes only before an act that cannot be undone. | Yes |
| 20 | The README example | `watch-logs` stays until a starter for other work exists. Its words are neutral: "watch something, wake an agent only for what is new, ask you before you act". | Yes |
| 43 | The order of work | Waves 0 to 3 (§3) | "yes! … you orchestrate all the work to subagents and only manage what needs to be built when. Also keep track of progression and findings along the way" |
| 44 | Where the alignment is written down | The steering docs carry the result. This record lists Q1 to Q44 and holds Progress and Findings. | Yes |

## 3. The waves (Q43)

- **Wave 0:** the docs and copy pass, ADR 22, ADR 23 and this record.
- **Wave 1:**
  - **A:** the optional project folder and the run folder (ADR 22).
  - **B:** typed outputs, Web request, Since last run, Convert and the three kits
    (ADR 23).
  - **C:** the metrics vocabulary, "useful" on every run, Needed you, and days.
- **Wave 2:**
  - **D:** the add-node dialog by family and the family tint, then viewers and
    dotted links.
  - **E:** reports.
  - **F:** "Where the work landed" and flow metrics.
  - **G:** the guided setup of an agent and a decider.
- **Wave 3:** Lock and Bypass, the first starter that is not about code, and
  signing the Mac app.

## Progress (2026-11-11)

One line per lane. The orchestrator adds the commits on main.

| Item | State | Where |
| --- | --- | --- |
| W0a The record, ADR 22, ADR 23 | In progress | |
| W0b Steering docs, PLAN, glossary, AGENTS.md | In progress | |
| W0c README, wiki, CONTRIBUTING, SECURITY | In progress | |
| W0d UI copy: web, phone, server, assistant | In progress | |
| A Optional project folder, run folder | Not started | |
| B Typed outputs, Web request, Since last run, Convert, kits | Not started | |
| C Metrics vocabulary, useful, Needed you, days | Not started | |
| D Add-node dialog by family, viewers, dotted links | Not started | |
| E Reports | Not started | |
| F Where the work landed, flow metrics | Not started | |
| G Guided setup of an agent and a decider | Not started | |
| Wave 3: Lock and Bypass | Not started | |
| Wave 3: the first starter that is not about code | Not started | |
| Wave 3: signing the Mac app | Not started | |

## Findings

The orchestrator adds findings as lanes report.
