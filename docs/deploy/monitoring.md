# Monitoring: send your runs to OpenTelemetry

Night Shift can send the runs a computer walks to a monitoring tool you
choose. Each run is one trace, and each step is a span in it. Metrics give
the time, cost, tokens, retries and Gate waits of your runs. Claude Code steps
also send their own usage, under the span of their step.

The export is off by default. Nothing leaves your computer until you turn it
on. Night Shift sends no prompts, no replies and no tool content: Claude Code's
switches for those stay off.

## Turn it on

In Night Shift, open **Settings → Monitoring**:

1. Turn on **Send runs to your monitoring**.
2. Set the **Address** of your OpenTelemetry receiver, for example
   `http://localhost:4318`. Night Shift adds `/v1/traces` and `/v1/metrics`.
3. Keep the **Format** on protobuf, unless your tool asks for JSON.
4. Add **Headers** when your tool needs an API key, one per line:
   `Authorization=Bearer abc123`. Night Shift keeps them in the system
   keychain, like a secret, and shows only their names after you save.

A change applies at once: no restart. Each computer has its own setting and
sends the runs it walks. A Host sends the runs it walks, a laptop its own.

On a server, you can also set the switch and the address in the environment:
`NIGHTSHIFT_TELEMETRY=on` and `NIGHTSHIFT_OTLP_ENDPOINT=http://collector:4318`.
A value saved in Settings wins over the environment.

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
- Import the dashboard: **Dashboards → New → Import**, then upload
  [`grafana/nightshift.json`](grafana/nightshift.json). Choose your
  Prometheus data source, a project and a flow at the top.
- Find a run's trace in **Explore → Tempo**, by the attribute
  `nightshift.run.id`, or with TraceQL: `{ resource.service.name = "nightshift" }`.

Data in this container is gone when it stops. Mount a volume on `/data` to
keep it.

## On a Host: SigNoz

[SigNoz](https://signoz.io/docs/install/docker/) keeps traces, metrics and
logs in ClickHouse and has dashboards and alerts for GenAI spans. Run it next
to the Host (its Docker Compose install, or the Dokploy template), and set the
Host's address to SigNoz's OTLP/HTTP receiver, for example
`http://signoz-otel-collector:4318`. Alerts on `nightshift.run.outcome` with
`end_reason="failed"`, or on `nightshift.run.cost_usd`, tell you about a bad
night.

## LangSmith, through your collector

Night Shift never calls LangSmith itself. Send to your own OpenTelemetry
collector, and let it pass the traces on to LangSmith with your API key:

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

The free Developer tier (5 000 traces a month, 14 days) fits one person: one
run is one trace. Self-hosted LangSmith is Enterprise only, so your traces
then live on LangSmith's servers.

## What Night Shift sends

### Spans

| Span | When |
| --- | --- |
| `invoke_workflow {flow}` | The run, from its start to its end: the root of the trace. A resumed run's later end is a span under it. |
| `invoke_agent {node}` | An Agent step. Claude Code's own spans hang under it. |
| `execute_tool {node}` | A Command or a Tool step. |
| `{kind} {node}` | Any other step (`decision`, `wait`, `call`, `value`, ...). A step in a called flow hangs under its Call step. |
| `gate {node}` | A Gate's wait for a person, with `nightshift.gate.wait_ms`. |
| `wait {reason}` | A sleep: a Wait node, a usage limit, the network, an offline Device. |

A span goes out when its step or run ends. Every span has
`nightshift.project.id`, `nightshift.flow.id`, `nightshift.run.id` (also as
`gen_ai.conversation.id`), and, on a step, `nightshift.step.id`,
`nightshift.node.kind`, `nightshift.device.id`, `nightshift.agent` and
`gen_ai.request.model`. All names are in
`packages/telemetry/src/conventions/names.ts`: the GenAI conventions of
OpenTelemetry are still in development, and that file follows them.

### Metrics

| Metric | Kind | Attributes |
| --- | --- | --- |
| `nightshift.run.duration` (s) | histogram | `end_reason` |
| `nightshift.step.duration` (s) | histogram | `nightshift.node.kind`, `nightshift.step.outcome`, `nightshift.agent` |
| `nightshift.run.cost_usd` | counter | `basis` (`billed`, `estimated`), `nightshift.agent`, `gen_ai.request.model` |
| `nightshift.tokens` | counter | `type` (`input`, `output`, `cache_read`, `cache_write`) |
| `nightshift.retries` | counter | `nightshift.node.kind`: a step that ran again |
| `nightshift.gate.wait` (s) | histogram | how long Gates waited for a person |
| `nightshift.run.outcome` | counter | `end_reason` (`finished`, `failed`, `stopped`, ...) |
| `nightshift.score` | counter | `nightshift.score.name`, `nightshift.score.label`: a Gate answered, a pull request outcome |
| `nightshift.pr.outcome` | counter | `outcome` (`merged`, `closed`, `reverted`) |

Each point also has `nightshift.project.id`, `nightshift.flow.id` and
`nightshift.device.id`. No point has the id of one run or step, so the series
stay few. Prometheus names them with `_` and a unit:
`nightshift_run_duration_seconds`, `nightshift_run_cost_usd_total`,
`nightshift_tokens_total`.

### Claude Code

While the export is on, a Claude Code step starts with
`CLAUDE_CODE_ENABLE_TELEMETRY=1`, the same address and headers, its metrics,
events and session trace on (`claude_code.cost.usage`, `api_request`), the
run and step ids in `OTEL_RESOURCE_ATTRIBUTES`, and `TRACEPARENT` set to the
step's span. `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES`,
`OTEL_LOG_TOOL_DETAILS` and `OTEL_LOG_TOOL_CONTENT` are set to `0`.

Other harnesses send nothing of their own. Night Shift's spans and metrics
cover their steps. Codex can send OpenTelemetry logs through its own config
(`-c otel.exporter=...`), but that would put your headers on its command
line, so Night Shift does not set it.
