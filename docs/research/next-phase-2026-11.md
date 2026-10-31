# Next phase: doors, guards, eyes and knowledge

**Status:** Sprints 1 to 3 on main except the pitch. Sprint 4 on main on
2026-10-31 except the proof on real nights (5.6), the pitch (5.7), a
scheduled evaluation kit and a few 5.8 items.
Sprint 3 changed after sprint 2: knowledge moves into the Space
([ADR 4](../adr/0004-knowledge-belongs-to-the-space.md)) before search. Follows the product and market
review of 2026-10-30 (items 08 "What to integrate" and 09 "Next 90 days").

Night Shift has run a real project every night since about 2026-10-16 and
earns its keep. The README status boxes and `docs/PLAN.md` §5 say otherwise;
they are stale. This plan starts from that fact: the core loop is proven, the
work now is to make the first bad night survivable, to open the doors other
tools walk through, to see what a night costs and does, and to give agents
more than the repo.

Eight weeks, four sprints. Each sprint ends with something a night uses. The
daemon on port 3000 runs real nights, so every change here is built in a git
worktree and lands on main between nights.

## 1. What is settled

| Topic | Decision |
| --- | --- |
| Scope | Lifted on 2026-10-30. A new node type, a Devices feature or an assistant feature is fine when a sprint item needs it. Prefer a kit when existing nodes can do the job. |
| Foundational | Integrations stay on files, git, shell CLIs, cron, webhooks and MCP connections a person brings. No vendor nodes. |
| Local first | Monitoring and knowledge work with no account and no network. Export to a third party is opt-in, one setting, off by default. |
| Harness | The Agent node keeps spawning the unmodified `claude` binary with the person's own login. No Agent SDK, no `claude-agent-acp`, for subscription profiles. |
| Where it lives | Guards go in the engine. Metrics are a read model over the event log. Export is a layer-3 vertical beside `notifications`. Knowledge is engine data per project, never a file in the repo. Since ADR 4 it belongs to the Project's Space, like flows. |

## 2. Sprint 1: record and guard (weeks 1 and 2)

Goal: the docs tell the truth, and a bad night cannot cost more than its budget.

### 2.1 Truth up the docs (half a day)

- `README.md`: check the first status box. Add one line: "Night Shift has run
  a real project every night since 2026-10-16."
- `docs/PLAN.md` §5: status line dated today. Slices 5 to 8 and the LangGraph
  engine run real nights. List what has still not happened for real: a usage
  limit at night, a Codex or OpenCode step, a planner that feeds a Subflow with
  `each` (check each against the real project's history and strike the ones
  that did happen).
- `docs/steering/TECH.md` stack table: React Flow, Codex, push, libsql, Electrobun rows.
- `docs/research/mobile.md` line 8, `examples/starters/README.md` and the
  starter files: format version 7. `examples/rpgdotexe/README.md`: 7.
- README table and glossary: one name, Subflow, as the app shows it.
  The flow JSON keeps `call`.
- PLAN §2 "Dropped: Jira" becomes "Jira is a kit on `acli`, not an engine concept."
- `SECURITY.md`: a short triage of the 30 audit findings. One line per high
  finding: why it does not reach the unattended surface.

### 2.2 Run budgets (engine, 3 days)

A flow sets its numbers; policy is engine code. Add to the flow's `policy`:

- `budget.usd`: the run stops `failed` with reason "budget" when the known
  cost passes it. Known cost is `read/cost.ts`; an estimate counts.
- `budget.turns` per Agent step. Claude Code gets `--max-turns` and
  `--max-budget-usd` (the step's share) on the command line. Other harnesses:
  the engine counts turns from the transcript and aborts the session.
- `stallMinutes` per Agent step: no transcript event for this long kills the
  session and ends the step `fail` with reason "stalled". Default 10. Symphony
  uses 5 minutes.
- A loop guard: three consecutive turns with the same tool call and arguments
  end the step `fail` with reason "looping".

Each guard is one event kind (`RunWarned` grows `kind`: `budget`, `stalled`,
`looping`) so the UI and the digest show it. Tests with the fake harness and
the fake clock, like the stop time.

### 2.3 Run metrics as a read model (engine + api + web, 4 days)

Today the dashboard rolls up per run only. Add `engine/src/read/run-metrics.ts`,
pure over the event log, per run and per step:

- wall time, agent time, tokens in, out, cache read, cache write;
- cost in USD with `basis`: `billed`, `estimated`, `unknown`;
- turns, tool calls, retries taken against the loop maximum;
- gate wait: `GateOpened` to the answering `StepEnded`;
- end reason, warnings, PR link from the step outputs when a kit opened one.

Expose through `api/src/dashboard`. In the web app: columns on the Runs table
(cost, tokens, length), a per-node row in the run's Results, and a 7-night
cost line per flow on the project dashboard. Nothing leaves the computer.

### 2.4 Morning digest (notifications, 2 days)

A new `NoticeKind` `digest`, built from the run metrics, sent once when quiet
hours end or at a time the person sets: one line per run that ended since the
last digest: status, cost, PR link or reason, and the Gates that wait. Push,
desktop and the phone's inbox. This is the feature every overnight thread asks
for and the one that makes the phone worth opening.

Done when: a budget stops a real run on purpose, the Runs table shows cost,
and the phone gets one digest in the morning.

## 3. Sprint 2: doors and the knowledge folder (weeks 3 and 4)

Goal: other tools can drive Night Shift, and an agent knows more than the repo.

### 3.1 The MCP server becomes the public door (2 days)

`nightshift mcp` exposes flow authoring and `start_run` today. Add the run
side so any agent or orchestrator can drive a night:

- `list_runs` (project, status, since), `get_run` (status, steps, cost, PR),
  `stop_run`;
- `needs_me`: open Gates across flows, with the question and the options;
- `answer_gate` (gate id, option, note);
- `get_digest` (since).

Same procedures the web app uses, through `packages/client`. Document in the
README under "Flows from a terminal", renamed "Drive Night Shift from a
terminal or an agent".

### 3.2 One webhook recipe, one GitHub Actions recipe (1 day)

Webhooks exist per schedule. Write `docs/deploy/triggers.md`: the signed
webhook, a `curl` example, and a GitHub Actions workflow that posts to it on
`pull_request` and on `workflow_dispatch`. That covers n8n, Make, Zapier,
Kestra, Windmill and Cursor automations without a connector for each.

### 3.3 Knowledge folder per project, phase 1 (engine + agents + flows, 5 days)

The research says: for code and small corpora, files plus grep beat a vector
index, and every vendor keeps write-back outside the source tree and behind
review. So phase 1 is files.

- A folder per project outside the repo:
  `<dataDir>/knowledge/<projectId>/` with `INDEX.md` that Night Shift
  generates (one line per file: path, title, first sentence, last synced).
  Subfolders are free. `learnings/` is reserved (3.4).
- The Agent node gets an optional `knowledge: true` (default on when the
  folder is not empty). The engine passes the folder through a new port field
  `AgentSessionInput.addDirs` and `instructions`. Claude Code: `--add-dir` and
  `--append-system-prompt "Project knowledge is in <path>. Read INDEX.md
  first, then grep."`. Codex: `additionalDirectories` and the same line in the
  prompt. OpenCode: the `instructions` glob. ACP agents: the line in the prompt.
- Sync is a kit of Commands on CLIs, run on a schedule or by hand, writing
  markdown into the folder: `kit:knowledge/github-wiki` (`git clone
  <repo>.wiki.git`), `kit:knowledge/jira` (`acli jira workitem view --json`
  to markdown), `kit:knowledge/confluence` (`atlcli` or `curl` on the REST
  API), `kit:knowledge/web` (`firecrawl-cli` or `curl r.jina.ai/<url>`),
  `kit:knowledge/files` (copy a folder or a glob). Each kit ends by
  regenerating `INDEX.md`.
- The Project page gets a Knowledge tab: the files, when each was synced,
  which kit fills it, a "Sync now" button, a size warning past 2 000 pages.
- Gitignored docs never reach a worktree. The `files` kit copies them in, so
  a project's `docs/private/` can be knowledge without a commit.

### 3.4 Learnings write-back behind a Gate (2 days)

An Agent step may end with `data.learnings`: a list of short notes. The engine
writes them to `knowledge/learnings/proposed/<runId>.md`. A `kit:knowledge/
review-learnings` flow opens a Gate with the proposals; accept moves them to
`learnings/accepted/`, reject deletes them. `INDEX.md` lists accepted only.
This copies Devin's suggestions and Claude Code's auto memory, kept out of the
repo and behind a person.

### 3.5 Onboarding (2 days)

- A dev default for `BETTER_AUTH_SECRET` when `NODE_ENV` is not production,
  with a log line that says it is the dev default.
- Starters imported when a project is added, with a checkbox to skip.
- CLI auto-detection: the Agents page finds `claude`, `codex`, `opencode`,
  `pi`, `gh`, `acli` on PATH and offers to register them.

Done when: an agent in Claude Code answers a Gate through the MCP server, a
real night reads the knowledge folder, and a new clone runs a starter in
fifteen minutes.

## 4. Sprint 3: shared knowledge, export and search (weeks 5 and 6)

Goal: every Device of a Space works on the same knowledge, a big knowledge
folder is searchable, and a person who wants dashboards gets them with one
setting.

Sprint 2 kept a knowledge folder on each Device. A run on the Host did not
see what the Mac synced, and a learning stayed on the Device whose agent
proposed it. [ADR 4](../adr/0004-knowledge-belongs-to-the-space.md) moves
knowledge into the Space. This is the one Devices feature in this plan: the
Scope row of section 1 allows it because search needs it.

Three lanes run at the same time: shared knowledge (4.0), search (4.3), and
export with scores (4.1, 4.2). Search builds its index from the folder on
each Device, so it does not wait for 4.0. The pitch (4.4) comes last, when
the rest is on main.

### 4.0 Knowledge in the Space (engine + devices + auth + web, 5 days)

- A `knowledge:<projectId>` Yjs document per Project, beside `flows:<id>`:
  one entry per file (path, sha256, size, changedAt, deviceId, `local` for a
  file over 10 MB). The relay serves it. `documentAccess` gives a Member
  read access, and a Device of a Member who may start runs write access.
- A content store per Device, by hash. The Device copies new content to
  the Space's Host and fetches what it lacks from there, over the run-state
  archive exchange (a new archive kind).
- `reconcile(projectId)` in `packages/engine/src/knowledge/`: before and
  after each step that gets the folder, and when the Knowledge page reads
  it. It compares the folder, a hidden state file of the last reconcile, and
  the document, then publishes local changes and writes remote ones. When
  both changed a path, the later change wins.
- The first start after the upgrade publishes each Device's folder.
- The Knowledge page lists the document, so it works on the Host and for
  every Member. Opening a file fetches its content. Where you add a source
  in a shared Space, the page says that every Member can read it.
- The learnings count on the page reads the document.

Done when: a sync on the Mac shows up in a run on the Host, and a learning
proposed on one Device is kept through the Gate on another.

### 4.1 OpenTelemetry export, opt-in (new vertical `packages/telemetry`, 5 days)

Bun has no working auto-instrumentation, so every span is written by hand
from the landed feed. That is also the honest design: the event log is the
source, telemetry is a projection.

- Settings: one OTLP endpoint, protocol (http/protobuf), headers. Off by
  default. The daemon preloads `otel.ts` with a tracer and meter provider,
  `BatchSpanProcessor`, `AsyncLocalStorageContextManager`, W3C propagator.
- Spans from `RunLog.onLanded`: `invoke_workflow {flow}` per run,
  `invoke_agent {node}` per Agent step, `execute_tool {name}` per Command and
  Tool step, a span per Gate with `nightshift.gate.wait_ms`, a span per Wait.
- Attributes on everything: `nightshift.project.id`, `nightshift.flow.id`,
  `nightshift.run.id` (also `gen_ai.conversation.id`), `nightshift.step.id`,
  `nightshift.node.kind`, `nightshift.agent`, `gen_ai.request.model`,
  `nightshift.device.id`. Pin the names in one module: the GenAI semantic
  conventions are still "Development" status.
- Metrics: `nightshift.run.duration`, `nightshift.step.duration` (histograms),
  `nightshift.run.cost_usd` (counter with `basis`), `nightshift.tokens`
  (counter with `type`), `nightshift.retries`, `nightshift.gate.wait`,
  `nightshift.run.outcome` (counter with `end_reason`), `nightshift.pr.outcome`.
- Spawned Claude Code sessions get `CLAUDE_CODE_ENABLE_TELEMETRY=1`,
  `OTEL_METRICS_EXPORTER=otlp`, `OTEL_LOGS_EXPORTER=otlp`, the same endpoint,
  `OTEL_RESOURCE_ATTRIBUTES=nightshift.run.id=...,nightshift.step.id=...`, and
  `TRACEPARENT` from the step span, so Claude's own `claude_code.cost.usage`
  and `api_request` land in the same backend under the step. Prompt and tool
  content logging stays off. Codex: a per-run `-c otel.*` override, to verify.
  OpenCode and pi: the engine's own metrics cover them.
- `@hono/otel` on the daemon and `ORPCInstrumentation` with propagation off,
  for request spans. Optional.
- Recipe in `docs/deploy/monitoring.md`: `grafana/otel-lgtm` in one container
  for a laptop, SigNoz on a Host for GenAI dashboards and anomaly alerts, and
  a Grafana dashboard JSON for the metrics above.

LangSmith is a sink behind the same door: an OTLP collector fans out to
`api.smith.langchain.com/otel/v1/traces` (EU: `eu.api...`) with the API key
and project headers. Night Shift never calls LangSmith itself, because the
JS client cannot send both OTLP and LangSmith-native from one process, and
because self-hosted LangSmith is Enterprise only, so it can never be "stays
on your computer". The free Developer tier (5 000 traces a month, 14-day
retention; one run is one trace) fits a solo developer who wants the
trajectory view, online evaluators and feedback keyed to runs. Document it as
"LangSmith through your collector", not a built-in.

### 4.2 Feedback scores (1 day)

When a kit's webhook reports a PR merged, closed or reverted, or a Gate is
answered, write a `Scored` event on the run (`pr_merged`, `gate_decision`,
`reverted_within_7d`). The metrics read model and the OTel counters pick it
up. This is the loop that later tells which prompt version merges.

### 4.3 Knowledge search, phase 2 (engine + MCP + web, 4 days)

An FTS5 table in the Replica (libsql) over the working copy's markdown and
text files. Each Device builds its own index after each reconcile, and
updates only the files whose hash changed. The index never syncs (ADR 4,
decision 7). The nightshift MCP server gains `search_knowledge` (BM25, top k
with snippets) and `read_knowledge` (one file), and lists the files as MCP
resources. The API gains `knowledge.search`, and the Knowledge page gets a
search field. An agent that reads the folder keeps using grep. A node that
wants search attaches the nightshift MCP server as a Connection. No
embeddings yet: as a tool, keyword search gives most of what a vector index
gives, at almost no cost.

Phase 3, not scheduled: `libsql_vector_idx` with Ollama embeddings
(`bge-m3` or `qwen3-embedding`) and hybrid ranking, only after an evaluation
on the project's own questions shows paraphrase misses.

### 4.4 The pitch (2 days)

Moved to sprint 4 (5.7), after the proof on real nights.

README, social preview and a one-page site lead with: every loop has a limit,
flows never touch your repo, your logins and your computers, answer gates
from your phone, mix any agent. The canvas is shown as the run view. A signed
DMG goes with it (`ELECTROBUN_DEVELOPER_ID`).

Done when: a night shows up in Grafana with Claude's own cost under the step
span, a Gate answer becomes a score, `search_knowledge` answers from a
Confluence export, and that export, synced on one Device, is found by a run
on another.

## 5. Sprint 4: find by meaning, and prove it (weeks 7 and 8)

Goal: a person adds knowledge without drawing a flow, agents find it by
meaning when keywords miss, and each done-when of sprints 1 to 3 is checked
on a real night.

Sprint 3 left two gaps that a person sees first. You could add knowledge
only by drawing a flow with a knowledge kit, and an Agent step got search
only when someone attached the nightshift MCP server. A review on
2026-10-30 also asked which LangChain products help the knowledge. The
answer: the retrieval pieces of LangChain.js do (splitters, Ollama
embeddings, the indexing API, `EnsembleRetriever`). LangSmith helps to
measure, not to store. The vendor loaders and the LangGraph memory store do
not fit (see "Not in this sprint").

### 5.0 Landing first (sprint 3 follow-ups, in progress on 2026-10-30)

- **Add source** on the Knowledge page: one Dialog for a folder on this
  computer, project files, web pages, a GitHub wiki, Jira or Confluence. It
  takes the kit's own inputs, an optional schedule, and syncs once. It
  writes an ordinary flow that calls the kit, so ADR 4 holds: a source is a
  sync flow. The page edits and removes it. A new `kit:knowledge/folder`
  copies any folder on the computer.
- **Search in every Agent step:** a step with knowledge on gets
  `search_knowledge` and `read_knowledge` through the engine's tool bridge,
  with no Connection to set up.
- **PDF and Word** files are knowledge: the index extracts their text,
  `read_knowledge` returns it, `INDEX.md` lists them. LangChain's
  `PDFLoader` and `DocxLoader` read them into `Document`s. `PDFLoader`
  gets the PDF.js of `unpdf`, so the loader also works in the binary.
- **A written spike** on vectors: `docs/research/knowledge-vectors.md`, with
  recall numbers for keyword, vector and hybrid search on this repo's docs.

### 5.1 Measure retrieval first (engine + web, 2 days)

Vectors cost an Ollama install and an index on every Device. They go on
only where a measurement says keyword search misses.

- Every `search_knowledge` call becomes an event on the run: the query, the
  files it returned, the step. The metrics read model and the OTel export
  pick it up. **Done** (6eb654ed): reads too, and MCP calls with no run.
- The Knowledge page gets "Questions agents asked": recent queries and what
  they found. A person marks the file that answers a question. Marked
  questions become the project's question set, kept in the knowledge
  document under a reserved `evals/` path, so it syncs like learnings and is
  never indexed. **Done** (6d7832f8, gated in 9852d15a).
- An evaluation runs the question set against keyword, vector and hybrid
  search and reports recall at 5 and the rank of the first right file. It
  runs from the page and as a kit, so a schedule can repeat it. The
  `openevals` evaluators or a plain script compute it. LangSmith is an
  opt-in place to send the results, not a requirement. **Done from the
  page** (9e94f2a3, a plain loop). Left: `kit:knowledge/evaluate` needs a
  way for a Command step to call Night Shift.
- The threshold that turns vectors on comes from the spike (5.0). Below it,
  the page says keyword search finds enough. **Done** (9e94f2a3): meaning is
  on by default, and the page offers to turn it off per project. A floor
  for meaning-only hits landed too (28c466fb, 0.50 for qwen3).

### 5.2 Find by meaning, phase 3 (engine, 5 days, only after 5.1)

**Status 2026-10-31: landed, ahead of 5.1, at the user's request.** Search
finds by meaning on each computer where Ollama answers and has
`qwen3-embedding:0.6b`. Without it, search finds by words only. It is not
turned on per project: 5.1 can still turn it off for a project later.
Keyword search uses the same sections, so a hit points at a section. On
this repo's docs, through `createKnowledgeSearch`: words 18 to 20 of 26,
words and meaning 21 to 22 of 26, vectors alone 23.

- Ollama in the Host image: done (1355241a). Night Shift starts and keeps
  `ollama serve` on a Host and downloads the model into the volume
  (9fcb1ea9). Model and address are owner settings (31f56339).
- Host CPU speed: done. Docker Desktop on an M4 Max, 16 vCPUs:
  0.25 sections/s with Ollama's default threads (1 156 sections, about
  77 min), about 2.5/s with 10 threads, 1.2 GB peak. Queries now go first
  during a preparation (69b92df0, 9c61dd4f).
- Still open: measure on the real Host, and set `num_thread` if its
  default is as slow there. Decide whether Devices share embeddings (below).

Behind the same `createKnowledgeSearch` port, so the API, the MCP tools,
the agent tools and the page do not change.

The spike ([knowledge-vectors.md](knowledge-vectors.md)) chose the pieces.
On this repo's docs, vector recall at 5 was 23 of 26 against 19 for
keyword search, and 11 of 13 against 7 on paraphrases.

- **Chunks:** `@langchain/textsplitters` cuts markdown by heading (1 200
  characters, 150 overlap). Keyword search uses the same chunks, so a hit
  points at a section, not a page.
- **Embeddings:** `@langchain/ollama` with `qwen3-embedding:0.6b` (1024
  dimensions, `num_ctx` 2048: it loads in about 1 GB instead of 4.8 GB). It
  handles Dutch. No Ollama on a Device: keyword search only, and the page
  says how to turn it on. Embedding runs in the background.
- **Incremental index:** `index()` from `@langchain/core/indexing`, keyed
  on the sha256 that the `knowledge:<projectId>` document already holds.
  LangChain's own record managers and stores do not work on Bun for this
  (`better-sqlite3` crashes Bun, `LibSQLVectorStore` never deletes old
  chunks), so a record manager and a store of about 40 lines each sit on
  bun:sqlite. The record manager's clock must strictly increase, and
  removed files need `cleanup: "full"`.
- **Store:** float32 BLOBs in a `chunks` table of the same `.search.sqlite`,
  searched by an exact scan (52 ms over 20 000 chunks). No extension, no
  native addon: `bun build --compile` is unaffected. sqlite-vec fails on
  macOS. libSQL vectors are the next step for very large projects.
- **Hybrid:** reciprocal rank fusion (c = 60) in `search.ts`, keyed by path.
  `EnsembleRetriever` moved to `@langchain/classic` and drops scores and
  snippets, so it does not fit the port.
- **Turn on per project** from the 5.1 measurement: offer vectors when
  keyword recall at 5 is under 80 % on at least 20 marked questions. Keep
  them only when hybrid beats keyword by at least 10 points.
- Before it lands: run the Linux binary in the Host image, and measure
  embedding speed on the Host's CPU.
- The model name is part of the index
  version, so a new model rebuilds the index.
- Open question for an ADR 4 amendment: share embeddings by content hash
  through the Host archive, so ten Devices do not embed the same file ten
  times. Decision 7 says the index never syncs. Embeddings are derived data
  too, so the default stays local until the cost says otherwise.

### 5.3 Sections, citations and use (engine + agents + web, 2 days)

- The nightshift MCP server lists the knowledge files as MCP resources.
  Sprint 3 promised this (4.3) and did not ship it. **Done** (c641fae4).
- The step report gets `sources`: the knowledge files the agent used. The
  run view shows them under the step. **Done** (3491f92d, 4c7adc9e).
  `read_knowledge` reads from a hit's section too (075f85a1).
- The Knowledge page shows how often each file was searched or cited, and
  marks files no run used in 30 days. That tells a person what to stop
  syncing. **Done** (7abc17d2).

### 5.4 Knowledge that stays healthy (engine + devices + web, 2 days)

- Garbage collection of archive content that no document lists any more.
  Done: daily on the Replica that keeps the Space, after 7 days (17222b8f).
- A Project whose id changes when a Device joins a Space moves its
  knowledge to the new id. Done: also its content on any Space move (0fc0f25c).
- Two Agent steps of one run that both propose learnings keep both.
  Done: one proposal file per step (ca0f2f3b).
- A Device and the Host compare builds before they exchange knowledge.
  An older Host gets a plain message, not a failed sync. Done: the link's
  one version test, an Alert on the page (c65d9e47).
- A source whose last sync failed shows an Alert on the page and a line in
  the digest. A source that has not synced in a week shows as stale.
  Done (5d888105). The phone shows the digest's sentence, not its lines.
- The Jira and Confluence kits need `jq`. The readiness check names it, and
  the Host image ships it. Done: the readiness check names jq and curl
  (93c066a9). The public image holds jq and curl (244fd1cb), and Ollama
  (1355241a): it holds everything the built-in kits and meaning search
  need, but no vendor CLIs.

### 5.5 Scores and telemetry, the rest (telemetry + engine, 2 days)

- PR scores: `pr_merged`, `pr_closed` and `reverted_within_7d` from a kit's
  GitHub webhook. The run metrics already hold the PR address, so the
  webhook finds its run by that address. Done (72fdd800): a webhook
  schedule with `scorePullRequests`, a revert read from a push or a Revert
  pull request. Left: a run that another Device walks gets no score.
- Codex spans and cost, as Claude has them. Done (ff0055c7): `-c otel.*`
  overrides, headers in the environment only. Left: verify on a real
  Codex that it reads `TRACEPARENT`.
- Spans for API requests, through `@orpc/otel`. Done (d09b27ec).
- Commands that a step runs no longer see the OTLP headers in their
  environment. Done (26cfcb4b). Left: on Linux a command can still read
  its parent's environment in `/proc`.

### 5.6 Proof on real nights (1 day, spread over the sprint)

Check each open done-when on the project that runs every night, and write
the result in this plan, true or not:

- Sprint 1: a budget stops a real run on purpose, and the phone gets one
  morning digest.
- Sprint 2: a real night reads the knowledge, and a new clone runs a
  starter in fifteen minutes.
- Sprint 3: Claude's own cost shows under the step span in Grafana, a Gate
  answer becomes a score, and a Confluence export synced on one Device is
  found by a run on another.

### 5.7 The pitch (2 days)

Moved from 4.4, unchanged. It goes last, when the proof of 5.6 is in.

### 5.8 Could, if there is time

- Past runs as knowledge: a run summary written to `runs/` in the
  knowledge, so later runs can find what earlier ones did (an idea from
  `delta.md`).
- Learnings that expire or merge: an accepted learning older than 90 days
  comes back to a Gate.
- Learnings in the step console, and the digest in the web inbox. Done:
  the step console (3f30bbc3), the web inbox (7160bba3).
- The Agents page shows OpenCode as found while it reports a problem. Fix
  that. Done: a found agent CLI shows its check's problem (a02d3469).
- The Knowledge page hides the source actions a person may not use. Done:
  `knowledge.get` says `can` (f4a3d658).
- A source value with `{{` made its flow impossible to edit. Done: it is
  refused, in the dialog and the engine (d196414b).
- A search snippet shows a score of 0. Fixed 2026-10-31 (5.2): the score is the fused rank score, never 0.
- A folder source synced only where its schedule pinned the run. Done: a
  Subflow names the computer its steps run on (`device`, **Runs on**), and
  a folder source names its own (e66dbeb7, 6bdad4cb, ac3d7dde, b2862645,
  5a658151). The Knowledge page and the source dialog name that computer
  (839da78d).
- Sources and kits refuse `evals/` as well as `learnings/` (26f0a38b).
- gh-aw lock file export and the ACP registry listing, an afternoon each.

### Not in this sprint

- The LangChain loaders for Confluence, Jira, Notion and GitHub: they are
  vendor integrations. The CLI kits stay.
- The LangGraph memory store for learnings: ADR 4 keeps learnings as plain
  files that sync through the Space.
- LangMem (Python only), LangGraph Platform and Open Agent Platform
  (hosted).
- LangSmith as a native sink: the OTel export already reaches it.

Done when: a person adds a folder and a web page from the Knowledge page,
and a run on another Device uses both. An evaluation on the real project's
own questions decides vectors on or off, with numbers. With vectors on, an
agent on a real night answers a question that keyword search missed. Each
done-when of sprints 1 to 3 is checked and written down.

## 6. Parked, on purpose

- Import of Claude Code dynamic workflow scripts: a demo for after the pitch.
- gh-aw lock file export, ACP registry listing: an afternoon each, after sprint 3.
- LangSmith as a native sink, Langfuse self-host recipes. Vectors moved to
  sprint 4 (5.2), behind a measurement.
- Delta (Zed) as a run sink or knowledge source: see `delta.md`. A kit
  when a project uses it; take its ideas (past runs as knowledge, changes
  anchored to the call that made them) without the dependency.
- Per-item `timeoutMinutes` on a Subflow with `each`, run retention, transcript
  deletion: PLAN §7 items that the budgets and metrics make visible first.

## 7. Risks

- Budgets on estimated cost: ACP reports cost only, Grok Build maybe nothing.
  A run on an unknown-cost harness gets a turn budget, never a USD budget, and
  the digest says "cost unknown".
- `--max-budget-usd` on Claude Code can be passed by subagents. The engine's
  own stop on known cost is the real guard.
- `--add-dir` loading a `CLAUDE.md` from the knowledge folder is version
  dependent in Claude Code. The prompt line is the reliable path; the
  `CLAUDE.md` stub is a bonus.
- OTel on Bun: no auto-instrumentation, `AsyncHooksContextManager` does not
  propagate across awaits. Hand-written spans and `AsyncLocalStorageContextManager` only.
- Vectors need Ollama on each Device and on the Host image. Without it,
  search falls back to keywords. A new embedding model means a full
  re-index.
- Multilingual knowledge: an English-only embedding model misses Dutch
  pages. The spike tests a multilingual model.
- Knowledge folders grow. The size warning and the phase 2 trigger exist for
  that; nothing loads the folder into a prompt.

## 8. Sources

The review of 2026-10-30 and its research notes. Key primary sources:
Anthropic, Effective context engineering for AI agents; Claude Code docs on
memory, `--add-dir`, monitoring usage and the CLI reference; the Agent Skills
specification; MCP resources (spec 2025-11-25); arXiv 2602.23368 (keyword
search as a tool) and 2605.15184 (grep versus vectors across harnesses);
Cursor on semantic search; Turso libsql vector docs; LangSmith docs on
tracing, OpenTelemetry, evaluation and pricing; LangChain.js docs on text
splitters, Ollama embeddings, the indexing API and `EnsembleRetriever`; the OpenTelemetry GenAI semantic
conventions; `@hono/otel`, `@orpc/otel`; the Symphony SPEC on stall and turn
limits; Paperclip and Devin budgets.
