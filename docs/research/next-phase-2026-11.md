# Next phase: doors, guards, eyes and knowledge

**Status:** Sprint 1 in progress (2026-10-30). Follows the product and market
review of 2026-10-30 (items 08 "What to integrate" and 09 "Next 90 days").

Night Shift has run a real project every night since about 2026-10-16 and
earns its keep. The README status boxes and `docs/PLAN.md` §5 say otherwise;
they are stale. This plan starts from that fact: the core loop is proven, the
work now is to make the first bad night survivable, to open the doors other
tools walk through, to see what a night costs and does, and to give agents
more than the repo.

Six weeks, three sprints. Each sprint ends with something a night uses. The
daemon on port 3000 runs real nights, so every change here is built in a git
worktree and lands on main between nights.

## 1. What is settled

| Topic | Decision |
| --- | --- |
| Scope | No new node types, no devices or mobile features, no assistant features until sprint 3 ends. Bug fixes only there. |
| Foundational | Integrations stay on files, git, shell CLIs, cron, webhooks and MCP connections a person brings. No vendor nodes. |
| Local first | Monitoring and knowledge work with no account and no network. Export to a third party is opt-in, one setting, off by default. |
| Harness | The Agent node keeps spawning the unmodified `claude` binary with the person's own login. No Agent SDK, no `claude-agent-acp`, for subscription profiles. |
| Where it lives | Guards go in the engine. Metrics are a read model over the event log. Export is a layer-3 vertical beside `notifications`. Knowledge is engine data per project, never a file in the repo. |

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

## 4. Sprint 3: export and search (weeks 5 and 6)

Goal: a person who wants dashboards gets them with one setting, and a big
knowledge folder is searchable.

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

### 4.3 Knowledge search, phase 2 (engine + MCP, 4 days)

When a project's folder passes about 2 000 pages or a person asks, an FTS5
table in the existing libsql over the folder's markdown, refreshed by the
sync kits. The nightshift MCP server gains `search_knowledge` (BM25, top k
with snippets) and `read_doc`, and lists the files as MCP resources with
`priority`. A node attaches it as a Connection named "Night Shift knowledge"
the way it attaches any connection. No embeddings yet: the measured gain of
keyword search as a tool is most of the gain of a vector index, at none of
the cost.

Phase 3, not scheduled: `libsql_vector_idx` with Ollama embeddings
(`bge-m3` or `qwen3-embedding`) and hybrid ranking, only after an evaluation
on the project's own questions shows paraphrase misses.

### 4.4 The pitch (2 days)

README, social preview and a one-page site lead with: every loop has a limit,
flows never touch your repo, your logins and your computers, answer gates
from your phone, mix any agent. The canvas is shown as the run view. A signed
DMG goes with it (`ELECTROBUN_DEVELOPER_ID`).

Done when: a night shows up in Grafana with Claude's own cost under the step
span, a Gate answer becomes a score, and `search_knowledge` answers from a
Confluence export.

## 5. Parked, on purpose

- Devices, Offers, the phone app and the assistant: bug fixes only.
- Import of Claude Code dynamic workflow scripts: a demo for after the pitch.
- gh-aw lock file export, ACP registry listing: an afternoon each, after sprint 3.
- Vectors, LangSmith as a native sink, Langfuse self-host recipes.
- Delta (Zed) as a run sink or knowledge source: see `delta.md`. A kit
  when a project uses it; take its ideas (past runs as knowledge, changes
  anchored to the call that made them) without the dependency.
- Per-item `timeoutMinutes` on a Subflow with `each`, run retention, transcript
  deletion: PLAN §7 items that the budgets and metrics make visible first.

## 6. Risks

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
- Knowledge folders grow. The size warning and the phase 2 trigger exist for
  that; nothing loads the folder into a prompt.

## 7. Sources

The review of 2026-10-30 and its research notes. Key primary sources:
Anthropic, Effective context engineering for AI agents; Claude Code docs on
memory, `--add-dir`, monitoring usage and the CLI reference; the Agent Skills
specification; MCP resources (spec 2025-11-25); arXiv 2602.23368 (keyword
search as a tool) and 2605.15184 (grep versus vectors across harnesses);
Cursor on semantic search; Turso libsql vector docs; LangSmith docs on
tracing, OpenTelemetry and pricing; the OpenTelemetry GenAI semantic
conventions; `@hono/otel`, `@orpc/otel`; the Symphony SPEC on stall and turn
limits; Paperclip and Devin budgets.
