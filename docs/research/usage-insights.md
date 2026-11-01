# Usage insights: strict OpenTelemetry, anonymous usage, and an Insights app

Date: 2026-11-01. Status: proposal. Nothing here is built yet.

## 1. The goal

Night Shift needs numbers from people other than its builder. The board asks
for the merged pull request rate of outside teams, the first five minutes,
and how many teams use two or more agents (`founder/board.md`, section 3).
The consumer panel says that proof is what blocks a sale (`founder/panel/results.md`).

This plan does three things, in this order:

1. It makes the existing export follow the OpenTelemetry standard strictly,
   and checks that in CI.
2. It adds an anonymous usage export. This export is on by default, and a
   person can turn it off. It goes to a server that Night Shift runs.
3. It adds a new app, `apps/insights`. The app receives the usage data,
   keeps it, and shows it to the Night Shift team behind a sign-in.

## 2. What exists today

- `packages/telemetry` sends the runs of a computer as OTLP traces and
  metrics to an endpoint that the person chooses. It is off by default
  (`packages/engine/src/device-config/settings.ts:396`).
- Spans and metrics come from the landed facts (`runs/projection.ts`).
  Span ids come from run and step ids (`conventions/ids.ts`).
- Claude Code and Codex sessions send their own telemetry under the step's
  span (`sessions/env.ts`). API requests are traced with `@orpc/otel`.
- There is no crash reporting, and no analytics in the web or phone app.
- There is no install id. The device id is shared with Hosts and in pairing,
  so it is not anonymous (`packages/devices/src/registry/self-device.ts:118`).
- The server binary and the daemon do not know their own version. Only the
  desktop app does (`apps/desktop/src/features/updates/updates.ts:61`).

### Why the existing export cannot go to our server

The existing export is for the person's own monitoring. It is not anonymous:

- Run spans carry flow names, project ids, node ids and the free-text end
  reason. A flow that has a client's name in it identifies that client.
- Claude Code's own telemetry carries `user.email`, `organization.id` and
  `user.account_uuid`. Some of these stay even with token sign-in
  ([Classmethod](https://dev.classmethod.jp/articles/claude-code-telemetry-login-token/),
  [OneUptime](https://oneuptime.com/docs/telemetry/claude-code)).
- A hash does not make a short name anonymous: a list of likely names
  finds it again.

So the usage export is a second projection with an allowlist. It uses the
same SDK, the same registry and the same landed facts. The session
environment (`sessionEnv`) never points at our server.

## 3. A principle changes: record it first

Today the docs say: "Export to a third party is opt-in, one setting, off by
default" (`docs/research/next-phase-2026-11.md:79`, `docs/steering/TECH.md`).
VISION principle 2 says that a step that sends data off the machine says so.
A usage export that is on by default changes this.

1. Write ADR 0011, "Night Shift sends anonymous usage by default". It holds
   the reason, the allowlist rule and the ways to turn it off.
2. Change TECH.md and VISION.md principle 2 to match.
3. Publish `docs/usage-data.md`. It lists every event and every field that
   leaves the computer. The registry generates this page (section 4).

There is a trust risk. Trust is the top reason that panel buyers pass, and
agency buyers ask for "no network access by default". These mitigations
keep the default and reduce the risk:

- The first start shows a notice with the switch and a link to the list of
  fields. It says this before the first event leaves the computer.
- Settings → Monitoring shows "What Night Shift sends". It lists the
  events that wait in the outbox and the last batch that was sent, as the
  JSON it was.
- `DO_NOT_TRACK=1`, `NIGHTSHIFT_USAGE=off` and `OTEL_SDK_DISABLED=true` turn
  it off. An environment value wins over the setting, as in the GitHub CLI
  ([GitHub CLI telemetry](https://docs.github.com/en/github-cli/github-cli/github-cli-telemetry)).
- A Space admin can turn it off for every computer in the Space. Agencies
  can then promise this to a client.
- The server keeps no IP address.

## 4. Phase 0: strict OpenTelemetry, checked in CI (first, about 4 days)

The GenAI conventions moved to their own repository,
[`semantic-conventions-genai`](https://github.com/open-telemetry/semantic-conventions-genai).
Its registry is `gen-ai-dev/1.42.0-dev`, and it builds on core semantic
conventions `1.44.0`. Its status is Development.

### 4.1 Gaps in the export today

| # | Gap | The standard | Night Shift today |
|---|---|---|---|
| 1 | Agent spans | `gen_ai.provider.name` is Required. Name: `invoke_agent {gen_ai.agent.name}` | No provider. Name uses the node id, with no `gen_ai.agent.name` |
| 2 | Run span | `gen_ai.workflow.name`. Name: `invoke_workflow {gen_ai.workflow.name}` | Only `nightshift.flow.id` |
| 3 | Failed spans | `error.type` is Conditionally Required: a short class, or `_OTHER` | A status message only |
| 4 | Duration metrics | `gen_ai.invoke_workflow.duration`, `gen_ai.invoke_agent.duration`, `gen_ai.execute_tool.duration` | `nightshift.run.duration`, `nightshift.step.duration` |
| 5 | Token metrics | `gen_ai.client.inference.usage.input_tokens`, `.output_tokens`, `.cache_read.input_tokens`, `.cache_write.input_tokens`. `gen_ai.usage.*` on the agent span | `nightshift.tokens` with an attribute `type` |
| 6 | Attribute names | Custom attributes have a namespace | `basis`, `type` and `outcome` have none |
| 7 | Resource | `service.version`, `os.type`, `host.arch`, `deployment.environment.name` | `service.name`, `service.instance.id` and a device id only |
| 8 | SDK configuration | `OTEL_EXPORTER_OTLP_ENDPOINT`, `_HEADERS`, `_PROTOCOL`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_SDK_DISABLED` | `NIGHTSHIFT_OTLP_ENDPOINT` and its own settings |
| 9 | Constants | Generated, or from `@opentelemetry/semantic-conventions` | Strings typed by hand in `conventions/names.ts` |
| 10 | Command steps | `execute_tool` is a tool that an agent calls | Also used for Command and Tool steps that the flow runs |

Gap 8 keeps the Night Shift setting. The `OTEL_*` variables become the
fallback that the SDK specification names. A value saved in Settings still wins.

Gap 10 needs a decision. The strict reading gives a Command step a span of
Night Shift's own, for example `nightshift.step {node}`.

Gap 7 needs a version at runtime. The build writes `NIGHTSHIFT_VERSION`
into the server binary, as it does for the desktop app.

### 4.2 The registry and the checks

1. Add a [Weaver](https://github.com/open-telemetry/weaver) registry in
   `packages/telemetry/registry/`. Its `manifest.yaml` depends on the GenAI
   registry, which depends on core semantic conventions.
2. The registry defines only what is Night Shift's own: the `nightshift.*`
   attributes, the cost metric and the usage events. It takes the standard
   names in with `ref:` and `imports:`.
3. `weaver registry generate` writes the TypeScript constants and the zod
   schemas of the usage events into a new package, `@nightshift/semconv`
   (layer 1, no dependencies). `conventions/names.ts` reads them from there.
4. `weaver registry update-markdown` writes `docs/usage-data.md` and the
   attribute tables in `docs/deploy/monitoring.md`.
5. CI runs `weaver registry check`. It fails on an invalid registry.
6. CI runs `weaver registry live-check`. A test walks runs through the
   in-memory engine and exports them to Weaver's OTLP receiver. The check
   fails on a name, type or unit that the registry does not define.
7. A new script, `scripts/check-semconv.ts`, fails on a `gen_ai.*` or
   `nightshift.*` string outside the generated files. The pre-commit hook
   runs it with `check-layers.ts`.
8. Renovate opens a pull request for a new GenAI registry.
   `weaver registry diff` shows what changes in it.

The Grafana dashboard (`docs/deploy/grafana/nightshift.json`) changes to the
standard metric names in the same pull request.

## 5. Phase 1: the usage export on the computer (about 4 days)

A new vertical, `packages/telemetry/src/usage/`.

### 5.1 How it sends

- Each event is an OTLP log record with `event.name`, as the OpenTelemetry
  events model has it. The registry defines each event and its attributes.
- It sends with the official logs SDK and the OTLP/HTTP exporter, to
  `https://ingest.<domain>/v1/logs`.
- Events wait in an outbox table in the local database. A laptop that
  sleeps at night sends them in the morning. The outbox keeps at most
  7 days and 5,000 events.
- It sends a batch at most once every 15 minutes, and at stop.
- The resource is `service.name=nightshift`, `service.version`, `os.type`,
  `host.arch`, and `service.instance.id` set to the install id.

### 5.2 How it makes data anonymous, on the computer

1. **Install id.** A random UUID v4, made on the first send and kept on this
   computer. It is not the device id. "Reset id" makes a new one.
2. **No free text.** No names, paths, URLs, prompts, commands, emails, host
   names, error text, flow names or node labels.
3. **Closed lists only.** Each enum attribute has a fixed list in the
   registry. A value outside the list becomes `_OTHER`. Example: a model
   name maps to a known family (`claude-sonnet`, `gpt-5`). A local or
   private model becomes `_OTHER`.
4. **Ids that do not link back.** A flow or a run becomes
   HMAC-SHA256(local key, id), cut to 16 characters. The key stays on this
   computer. The server can count distinct flows and runs per flow. It
   cannot get the name. "Reset id" also makes a new key.
5. **Coarse numbers.** Cost rounds to whole cents. Times round to the
   second. Event time rounds to the minute.
6. **The server checks again.** It refuses an unknown attribute or an
   unknown event (section 6.2). The check on the computer is the main one.

### 5.3 The setting

- A new setting, `usage`, default `true`, next to `telemetry` in `DEFS`.
  The UI is a switch in `monitoring-card.tsx`. It is apart from "Send runs
  to your monitoring".
- A Space setting, "Send anonymous usage", that a Space admin can turn off.
- The first-start notice, in the desktop app and in the web app of a Host.
- The "What Night Shift sends" view (section 3).

## 6. Phase 2: the Insights app (about 5 days)

### 6.1 Shape

```
Night Shift ──OTLP/HTTP──▶ Cloudflare ──▶ OpenTelemetry Collector ──OTLP/HTTP JSON──▶ apps/insights ──▶ Postgres
                           (ingest.<domain>)  (contrib image)                         (internal)
Team ──▶ Cloudflare Access ──▶ apps/insights admin UI (insights.<domain>) ──▶ Postgres
```

- **The edge is the official Collector**, the `otel/opentelemetry-collector-contrib`
  image. Anyone can put the same Collector in front of their own tools.
  Its pipeline: `otlp` receiver, `memory_limiter`, a `redaction` processor
  with `allow_all_keys: false` and the allowed keys from the registry,
  `batch`, then an `otlphttp` exporter with JSON to the app
  ([Honeycomb on redaction](https://docs.honeycomb.io/getting-data-in/otel-collector/security/)).
  Weaver generates the list of allowed keys.
- **`apps/insights`** is one Bun process with Hono:
  - `POST /v1/logs` on the internal network only. It parses OTLP JSON,
    checks each event against `@nightshift/semconv`, and writes rows.
  - `/api/auth/*` for Better Auth.
  - `/rpc/*` for the admin API with oRPC, as in the main app.
  - The admin UI: React, Vite, `packages/ui` (shadcn), TanStack Router,
    as in `apps/web`.
- **The domain logic goes in a package**, `packages/insights`: the ingest
  rules, the storage schema (Drizzle, Postgres) and the queries. The app
  only wires them. STRUCTURE.md gets a row for both.
- **Storage is Postgres**, as a Dokploy database. One `usage_event` table
  has typed columns for the common fields and `jsonb` for the rest.
  Aggregates are SQL views. If volume grows past what Postgres holds well,
  swap the Collector's exporter to ClickHouse, with no change on the
  computers.

### 6.2 Protection

Ingest (public, no secret, because any key in a shipped app is public):

- Cloudflare WAF rate limit: for example 60 requests a minute per IP.
- The Collector refuses a body over 256 KB, and `memory_limiter` protects it.
- The app refuses an unknown event, an unknown attribute or a wrong type.
- The app reads `CF-IPCountry` if you choose to keep a country. It never
  stores an IP address. The Collector does not log one.
- False data is possible. The admin UI flags installs with numbers far
  outside the normal range.

Admin UI (two layers):

1. **Cloudflare Access** in front of `insights.<domain>`. Only the team's
   emails pass. It is free for up to 50 users.
2. **Better Auth** in the app. Sign-up is off. Sign-in is with GitHub,
   allowed for a list of accounts, or with email, password and two-factor
   sign-in. The `admin` plugin gives roles. Sessions are short. This uses
   the same Better Auth version as `packages/auth`, with a database of its own.

### 6.3 The admin pages

All built from shadcn components and blocks, as `docs/shadcn.md` asks.

1. **Overview.** Active installs this week, nights with runs, merged pull
   request rate, cost per kept pull request.
2. **First night.** The setup funnel with the time between steps and the
   place where installs stop (section 8.1).
3. **Nights.** Runs per night, how runs end, which guards stop them.
4. **Mornings.** Pull requests opened, merged, closed and reverted. Gates
   answered, and how fast.
5. **Mix.** Agents per install, OS, desktop or Host, versions.
6. **Retention.** Weekly cohorts by the week of the first run.

## 7. Phase 3: deploy on Dokploy behind Cloudflare (about 1 day)

1. Add `deploy/insights/Dockerfile` and `deploy/insights/collector.yaml`.
2. In Dokploy, make a project "Night Shift Insights" with three services:
   Postgres, the Collector, and the app.
3. Give the app two domains in Dokploy: `ingest.<domain>` to the Collector
   and `insights.<domain>` to the app.
4. In Cloudflare, add both names as proxied DNS records. Set TLS to Full
   (strict) with a Cloudflare origin certificate on Traefik. As an
   alternative, use a Cloudflare Tunnel, as in `docs/deploy/tunnel.md`.
5. Allow only Cloudflare's IP ranges to reach the origin.
6. Add the Access application and the WAF rate limit rule.
7. Turn on daily Postgres backups in Dokploy.
8. Point the default usage endpoint in the build at `ingest.<domain>`.

## 8. What to measure

### 8.1 Events of the usage export

Each event below says where its moment is in the code today, and what is missing.

**Setup and first night** (the board's first five minutes)

| Event | Attributes | Where | Missing |
|---|---|---|---|
| `nightshift.install.started` | entry (`desktop`, `server`), `host` bool | `packages/daemon/src/start.ts:30` | A runtime version in the server |
| `nightshift.agent.checked` | `gen_ai.provider.name`, harness, `installed`, `signed_in` | `packages/agents/src/harnesses/registry.ts:47` | A structured "signed in" state. Today it is free text |
| `nightshift.project.added` | `source` (`folder`, `github`), `has_remote`, `starters` | `packages/api/src/projects/router.ts:55` | |
| `nightshift.project.checked` | each step `ok`, `failed`, `skipped` | `packages/engine/src/projects/project-setup.ts:216` | |
| `nightshift.flow.created` | `from` (`starter`, `blank`, `import`, `copy`), starter name | `packages/engine/src/flows/space-flows.ts:346` | A blank flow is an ordinary save today |
| `nightshift.schedule.changed` | `enabled`, `webhook`, `score_pull_requests` | `packages/engine/src/schedules/schedule-files.ts:200` | Events. Today a save rewrites the whole file |

The server finds the first run, the first finished run, the first pull
request and the second night from the events below. It needs no extra event for them.

**Nights**

| Event | Attributes | Where | Missing |
|---|---|---|---|
| `nightshift.run.ended` | trigger, status, `end_reason`, duration, cost, hashed flow id, node kinds used | `packages/engine/src/graph/runner.ts:541` | A structured end reason. Today it is free text |
| `nightshift.step.ended` | node kind, outcome, `gen_ai.provider.name`, model family, tokens, cost basis, `guard`, `error.type`, visit | `runs/projection.ts` | `turns` reports as `budget` (`step-runner.ts:121`). maxSteps and the stop time end with text only |
| `nightshift.schedule.fired` / `.skipped` | skip reason | `packages/engine/src/schedules/scheduler.ts:296`, `:382` | A structured skip reason |

**Mornings**

| Event | Attributes | Where | Missing |
|---|---|---|---|
| `nightshift.gate.answered` | `by` (`person`, `deadline`), `via` (`web`, `phone`, `lock_screen`), wait time, has deadline, is form | `packages/engine/src/graph/gate.ts:55` | Phone or web is not recorded. Only `lock-screen` is |
| `nightshift.pull_request.opened` | hashed run id | `packages/engine/src/read/run-metrics.ts:165` | The URL is not stored on the run. It is read from outputs |
| `nightshift.pull_request.outcome` | `merged`, `closed`, `reverted`, hours to outcome | `packages/engine/src/schedules/pull-request-scores.ts:130` | Works only with a GitHub webhook and `scorePullRequests` |

**Platform and reliability**

| Event | Attributes | Where |
|---|---|---|
| `nightshift.install.active` | once a day: OS, arch, versions, agents found, phone signed in, paired with a Host, Spaces count bucket, members bucket | daily |
| `nightshift.process.crashed` | `error.type` only | `packages/daemon/src/runtime/process-guard.ts:32` |

### 8.2 Gaps to close in the engine (phase 4, about 4 days)

1. **Pull request outcome without a webhook.** This is the board's main number.
   Most teams will not set up a webhook. Store the pull request URL on the
   run when it is opened. Ask `gh pr view` each morning until the request
   is merged or closed. This uses only a CLI, so it fits the
   "foundational" rule.
2. **A structured end reason** on `RunEnded`: `finished`, `guard.budget`,
   `guard.turns`, `guard.looping`, `guard.idle`, `guard.max_steps`,
   `stop_time`, `agent.usage_limit`, `agent.network`, `agent.signed_out`,
   `stopped_by_person`, `_OTHER`. The UI text still comes from it. Telemetry
   and the morning digest read the code. This also fills `error.type`.
3. **Tell `turns` apart from `budget`** in `GUARD_WARNINGS`.
4. **A structured sign-in state** for each agent check: `signed_in`,
   `signed_out`, `unknown`.
5. **`via` on a Gate answer**: web, phone or lock screen.
6. **A one-tap "Useful?"** on each pull request in the morning digest, on
   the phone and on the desktop. It lands as a score. Telemetry cannot see
   time saved, but a person can say it in one tap.

### 8.3 The numbers that come out

| Number | Answers |
|---|---|
| Merged pull requests ÷ opened, per install, per week | The board's proof condition |
| Reverted within 7 days ÷ merged | Rework |
| Cost per merged pull request | The value story, and pricing |
| Median time from install to first finished run, and to first merged pull request | The first five minutes |
| Where installs stop in the funnel | What to fix first |
| Share of installs with two or more agents | The board's open number on the segment |
| Share of runs stopped by each guard | Proof that the caps work. The panel asked for this |
| Weekly active installs, nights per week, week-4 retention | Whether the morning is real |
| Gates answered by a person ÷ by deadline, and median time | Whether the inbox works |
| Phone or desktop for answers | Whether the phone is worth its cost |
| Starter used for the first flow | Which starter to lead with |

Aggregates without names can also go on a public page. A live merge rate
across all installs is the proof the panel asked for.

## 9. Open decisions

1. **Domain.** Which domain hosts `ingest.` and `insights.`?
2. **Command steps.** Agree with the strict reading of gap 10?
3. **Country.** Keep `CF-IPCountry`, or no location at all? Recommendation: keep the country.
4. **Storage.** Postgres first, ClickHouse later? Recommendation: yes.
5. **Hosts.** Does a Host container send usage by default, as the desktop does?
   Recommendation: yes, with `NIGHTSHIFT_USAGE=off` in the compose file comments.
6. **Public page.** Publish the aggregate numbers? Recommendation: yes, once 5 teams send data.

## 10. Order and size

| Phase | What | Size |
|---|---|---|
| 0 | Strict OpenTelemetry: registry, generated constants, gaps 1–10, CI checks | 4 days |
| 1 | Usage export: outbox, allowlist, setting, notice, "What Night Shift sends" | 4 days |
| 2 | `apps/insights` and `packages/insights`: ingest, Better Auth, admin pages | 5 days |
| 3 | Dokploy, Collector, Cloudflare DNS, Access and WAF | 1 day |
| 4 | Engine gaps: PR outcome by `gh`, end reason codes, sign-in state, `via`, "Useful?" | 4 days |

Phase 4 items 1 and 2 can start next to phase 0. They change the engine,
not the export.

## Sources

- OpenTelemetry GenAI semantic conventions:
  [repository](https://github.com/open-telemetry/semantic-conventions-genai),
  agent spans, metrics and token metrics in `docs/gen-ai/`.
- [Weaver](https://github.com/open-telemetry/weaver) and its
  [guide to your own registry](https://github.com/open-telemetry/weaver/blob/main/docs/define-your-own-telemetry-schema.md).
- [Collector redaction processor, Honeycomb](https://docs.honeycomb.io/getting-data-in/otel-collector/security/),
  [Collector processors, OneUptime](https://oneuptime.com/blog/post/2026-02-09-otel-collector-processors/markdown).
- Claude Code telemetry attributes:
  [Elastic](https://www.elastic.co/docs/reference/integrations/claude_code),
  [OneUptime](https://oneuptime.com/docs/telemetry/claude-code),
  [Classmethod](https://dev.classmethod.jp/articles/claude-code-telemetry-login-token/).
- Opt-out conventions:
  [GitHub CLI telemetry](https://docs.github.com/en/github-cli/github-cli/github-cli-telemetry),
  [DO_NOT_TRACK proposal](https://feedbagel.com/post/donottrack),
  [1984vc/telemetry-todo](https://github.com/1984vc/telemetry-todo).
