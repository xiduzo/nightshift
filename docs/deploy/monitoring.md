# Monitoring: send your runs to OpenTelemetry

Night Shift can send the runs a computer walks to a monitoring tool you
choose. Each run is one trace, and each step is a span in it. Metrics give
the time, cost, tokens, retries and Gate waits of your runs. They also tell
where the work landed and give the numbers your flows report. Claude Code
steps also send their own usage, under the span of their step. Codex steps
send their own usage too.

The export is off by default. Nothing leaves your computer until you turn it
on. Night Shift sends no prompts, no replies and no tool content. The
switches of Claude Code and Codex for those stay off.

## Turn it on

In Night Shift, open **Settings → Monitoring**:

1. Turn on **Send runs to your monitoring**.
2. Set the **Address** of your OpenTelemetry receiver, for example
   `http://localhost:4318`. Night Shift adds `/v1/traces` and `/v1/metrics`.
3. If your tool asks for JSON, change the **Format**. Else keep protobuf.
4. If your tool needs an API key, add a **Header**, for example
   `Authorization` with the value `Bearer ${GRAFANA_TOKEN}`. Save the key
   itself on the Secrets page as `GRAFANA_TOKEN`. On a Host, save it as
   **This computer**, or set it in the environment. The export does not
   read Space or Project secrets. A value that is not secret, such as a
   tenant id, can stay as written.

A header keeps only the `${NAME}` reference. The key stays in the secrets,
and the record of a step shows it as `•••`. Headers saved by an older
Night Shift move to the Secrets page at start, as `OTEL_HEADER_<NAME>`.

A change applies at once, with no restart. A new value of a secret that a
header reads applies at once too. Each computer has its own setting
and sends the runs it walks. A Host sends the runs it walks, a laptop its
own.

On a server, you can also set the switch and the address in the environment:
`NIGHTSHIFT_TELEMETRY=on` and `NIGHTSHIFT_OTLP_ENDPOINT=http://collector:4318`.
A value saved in Settings wins over the environment.

If the switch is on and the address is empty, Night Shift uses
`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` and
`OTEL_EXPORTER_OTLP_PROTOCOL`. It speaks `http/protobuf` and `http/json`.
`OTEL_SDK_DISABLED=true` turns the export off. An OTEL address does not
turn the switch on.

## On a laptop: Grafana in one container

`grafana/otel-lgtm` runs an OpenTelemetry collector, Tempo (traces),
Prometheus (metrics), Loki (logs) and Grafana in one container:

```bash
docker run --rm --name lgtm \
  -p 3300:3000 -p 4318:4318 \
  grafana/otel-lgtm
```

- Set the address in Night Shift to `http://localhost:4318`.
- Open Grafana at <http://localhost:3300> (user `admin`, password `admin`).
  Port 3000 is Night Shift's own, so Grafana gets 3300 here.
- Import the dashboard: open **Dashboards → New → Import**, then upload
  [`grafana/nightshift.json`](grafana/nightshift.json). At the top, choose
  your Prometheus data source, a project and a flow.
- Find a run's trace in **Explore → Tempo**, by the attribute
  `nightshift.run.id`, or with TraceQL: `{ resource.service.name = "nightshift" }`.

The container loses its data when it stops. To keep the data, mount a
volume on `/data`.

## On a Host: SigNoz

[SigNoz](https://signoz.io/docs/install/docker/) keeps traces, metrics and
logs in ClickHouse. It has dashboards and alerts for GenAI spans.

1. Run SigNoz next to the Host, with its Docker Compose install or the
   Dokploy template.
2. On the Host, set the address to SigNoz's OTLP/HTTP receiver, for example
   `http://signoz-otel-collector:4318`.

Alerts on `nightshift.run.outcome` with `nightshift.run.status="failed"`, or on
`nightshift.run.cost_usd`, tell you when runs fail or cost too much.

## LangSmith, through your collector

Night Shift never calls LangSmith itself. Send to your own OpenTelemetry
collector. It sends the traces to LangSmith with your API key:

```yaml
# otel-collector.yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
exporters:
  otlphttp/langsmith:
    # EU: https://eu.api.smith.langchain.com/otel
    endpoint: https://api.smith.langchain.com/otel
    headers:
      x-api-key: ${env:LANGSMITH_API_KEY}
      Langsmith-Project: nightshift
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp/langsmith]
```

```bash
docker run --rm -p 4318:4318 -e LANGSMITH_API_KEY \
  -v "$PWD/otel-collector.yaml:/etc/otelcol-contrib/config.yaml" \
  otel/opentelemetry-collector-contrib
```

The free Developer tier (5 000 traces a month, 14 days) fits one person,
because one run is one trace. Self-hosted LangSmith is Enterprise only. Thus
your traces stay on LangSmith's servers.

## What Night Shift sends

### Spans

| Span | When |
| --- | --- |
| `invoke_workflow {flow}` | The run, from its start to its end: the root of the trace. A resumed run's later end is a span under it. The flow name is `gen_ai.workflow.name`. `nightshift.run.needed_you` says whether a person stepped in. |
| `invoke_agent {agent}` | An Agent step. The agent name is the node id (`gen_ai.agent.name`). `gen_ai.provider.name` is set. Claude Code's own spans hang under it. |
| `nightshift.step {node}` | A Command step, a Tool step, or any other step the flow runs. `nightshift.node.kind` says which. This is not `execute_tool`. `execute_tool` is a tool an agent calls. A step in a called flow hangs under its Call step. |
| `gate {node}` | A Gate's wait for a person, with `nightshift.gate.wait_ms`. |
| `wait {reason}` | A sleep: a Wait node, a usage limit, the network, an offline Device. |
| `orpc.{procedure}` | An API request this computer answers, from the web app, the phone or a peer, with `call_procedure`, `handler` and the input checks under it. A request to a Host is `send_request`. Each request is a trace of its own. |

A span goes out when its step or run ends. Every span of a run has
`nightshift.project.id`, `nightshift.flow.id`, `nightshift.run.id` (also as
`gen_ai.conversation.id`), and, on a step, `nightshift.step.id`,
`nightshift.node.kind`, `nightshift.device.id`, `nightshift.agent` and
`gen_ai.request.model`. An Agent step that searched or read the project's
knowledge also has `nightshift.knowledge.searches` and
`nightshift.knowledge.reads`. A failed span has `error.type`. The resource
has `service.name` `nightshift`, `service.version`, `os.type`, `host.arch`
and `deployment.environment.name`. The names come from `@nightshift/semconv`.
The GenAI conventions are still in development.

### Metrics

| Metric | Kind | Attributes |
| --- | --- | --- |
| `gen_ai.invoke_workflow.duration` (s) | histogram | `gen_ai.workflow.name`, `nightshift.run.status` |
| `gen_ai.invoke_agent.duration` (s) | histogram | `gen_ai.provider.name`, `gen_ai.agent.name` |
| `nightshift.step.duration` (s) | histogram | `nightshift.node.kind`, `nightshift.step.outcome`. An Agent step uses `gen_ai.invoke_agent.duration` instead. |
| `nightshift.run.cost_usd` | counter | `nightshift.cost.basis` (`billed`, `estimated`), `nightshift.agent`, `gen_ai.request.model`: the same cost as the Spend tab, also for a run that was cut short. A try on a ladder adds `nightshift.ladder.rung`: the rung it stands on. |
| `gen_ai.client.inference.usage.input_tokens` | counter | `gen_ai.token.modality`, `gen_ai.provider.name` |
| `gen_ai.client.inference.usage.output_tokens` | counter | `gen_ai.token.modality`, `gen_ai.provider.name` |
| `gen_ai.client.inference.usage.cache_read.input_tokens` | counter | `gen_ai.token.modality`, `gen_ai.provider.name` |
| `gen_ai.client.inference.usage.cache_write.input_tokens` | counter | `gen_ai.token.modality`, `gen_ai.provider.name` |
| `nightshift.retries` | counter | `nightshift.node.kind`: a step that ran again |
| `nightshift.gate.wait` (s) | histogram | how long Gates waited for a person |
| `nightshift.run.outcome` | counter | `nightshift.run.status` (`finished`, `failed`, `stopped`, ...), `nightshift.run.needed_you` (whether a person answered a Gate or an Ask, resumed, stopped or took over the run) |
| `nightshift.score` | counter | `nightshift.score.name`, `nightshift.score.label`, `nightshift.score.by` (`person`, `deadline`). See the names below. |
| `nightshift.ladder.rung` | counter | `nightshift.ladder.kind`, `nightshift.ladder.rung`, `nightshift.ladder.tier`, `nightshift.ladder.unsure`, `nightshift.node.kind`: one point for each climb that landed. See [Where the work landed](#where-the-work-landed). |
| `nightshift.flow.metric` | histogram | `nightshift.flow.metric.name`: a number a Command, Agent or Value step reported in its data, such as `{"scores": {"leads_found": 12}}` |

`nightshift.score.name` says what a score point is:

| Name | Value |
| --- | --- |
| `gate_decision` | A Gate was answered. The label is the option, and `nightshift.score.by` says who chose it. |
| `useful` | A person answered "Was this run useful?": 1 for yes, 0 for no. An older Night Shift writes `pr_useful`. |
| `pr_merged`, `pr_closed`, `reverted_within_7d` | What became of a run's pull request, from a schedule that [scores pull requests](triggers.md#score-runs-by-their-pull-requests). |

A counter only adds. A no to "Was this run useful?" adds 0, and a changed
answer adds its new value again.

A test run (a run with pinned or skipped nodes, [ADR 27](../adr/0027-a-test-run-carries-its-pins-and-skips.md))
counts only in the spend, as in the app. It sends the
`nightshift.run.cost_usd` and token counter points of its steps, and no span
and no other point.

A flow chooses the name of each number it reports, and what the value
means. A `nightshift.flow.metric` point has the value in its sum and count,
so you can read a total and an average per name.

#### Where the work landed

A climb is the tries of one node up its ladder, up to the step it landed
on. A node without a cascade lands on each visit. The step a climb landed
on adds one `nightshift.ladder.rung` point. A Subflow without a cascade
adds no point: the steps of the flow that it calls add theirs.

- `nightshift.ladder.kind` is `work` (an Agent, a Subflow with a cascade,
  a Value by a model or an Ask) or `choice` (a Decision).
- `nightshift.ladder.tier` is the name of the tier it landed on. A node
  without a cascade has none.
- `nightshift.ladder.unsure` is on a Decision's point. It is `true` when a
  decider's pick fell below the minimum of its tier on a try.
- `nightshift.ladder.rung` is one of these:

| Rung | Where the climb landed |
| --- | --- |
| `rule` | A rule chose. |
| `first` | The first tier held, or a node without a cascade did. |
| `later` | A later tier held. |
| `person` | The climb reached a person, who answered. |
| `deadline` | The climb reached a person, and the deadline answered. |
| `none` | No try held, and no person was asked. |

The cost of each try on a ladder is a `nightshift.run.cost_usd` point with
the rung that try stands on: `rule`, `first`, `later` or `person`. A step
that a person reopens lands again when it ends again.

#### Changed names

Night Shift no longer sends `nightshift.pr.outcome`. The same facts are the
`nightshift.score` points `pr_merged`, `pr_closed` and `reverted_within_7d`.
A dashboard that reads `nightshift_pr_outcome_total` must read
`nightshift_score_total` instead.

Night Shift no longer sends the numbers a flow reports as `nightshift.score`
points. They are `nightshift.flow.metric` points now, with the name in
`nightshift.flow.metric.name`. A dashboard that reads such a name from
`nightshift_score_total` must read `nightshift_flow_metric_sum` and
`nightshift_flow_metric_count` instead. `nightshift.score` keeps only the
names in the table above.

Each point also has `nightshift.project.id`, `nightshift.flow.id` and
`nightshift.device.id`. No point has the id of one run or step, so there are
few series. Prometheus names them with `_` and a unit:
`gen_ai_invoke_workflow_duration_seconds`, `nightshift_run_cost_usd_total`,
`gen_ai_client_inference_usage_input_tokens_total`. A unit in braces, such as
`{token}` or `{USD}`, adds no suffix.

### Claude Code

While the export is on, a Claude Code step starts with:

- `CLAUDE_CODE_ENABLE_TELEMETRY=1`, and the same address and headers.
- Its metrics, events and session trace on (`claude_code.cost.usage`,
  `api_request`).
- The run and step ids in `OTEL_RESOURCE_ATTRIBUTES`.
- `TRACEPARENT` set to the step's span.
- `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES`,
  `OTEL_LOG_TOOL_DETAILS` and `OTEL_LOG_TOOL_CONTENT` set to `0`.

The commands that a step runs do not see your headers:

- Claude Code 2.1.128 and later keeps its `OTEL_*` variables from the
  commands it runs: Bash, hooks and MCP servers.
- An older Claude Code would pass them on. Night Shift then leaves the
  headers out, so its own export goes without them. Update Claude Code.
- A Command step never gets the export's variables.

One gap stays. On Linux, a command of the same user can read the
environment of its parent process in `/proc`. On macOS it cannot.

### Codex

While the export is on, a Codex step starts with:

- Its own logs, metrics and traces to the same address, set with
  `--config otel.exporter`, `otel.trace_exporter` and
  `otel.metrics_exporter`. Each one has its full path, for example
  `/v1/traces`.
- `otel.log_user_prompt = false`, so your prompts stay out.
- Your headers in `OTEL_EXPORTER_OTLP_HEADERS`, never on the command line.
- `shell_environment_policy.exclude = ["OTEL_*"]`, so the commands Codex
  runs do not see the headers. This replaces an `exclude` list in your own
  Codex config for that step.
- The run and step ids in `OTEL_RESOURCE_ATTRIBUTES`, and `TRACEPARENT`
  set to the step's span.

Codex reports tokens, not dollars. Night Shift prices the tokens:
`nightshift.run.cost_usd` counts a Codex step with `nightshift.cost.basis="estimated"`.
Nobody checked here that Codex reads `TRACEPARENT` and
`OTEL_RESOURCE_ATTRIBUTES`. Without them, its spans have a trace of their
own, with `service.name` `codex_exec`.

Other harnesses (OpenCode, pi, ACP agents) send nothing of their own.
Night Shift's spans and metrics cover their steps.
