# Usage data

Night Shift defines a closed list of usage events. Each event has a fixed set of fields. A value outside a field's list is `_OTHER`.

A released build of Night Shift sends these events to the Night Shift team. A run from source sends nothing. Turn usage off in Settings, or set `NIGHTSHIFT_USAGE=off` or `DO_NOT_TRACK=1`. The run export in [Monitoring](deploy/monitoring.md) is separate. That export goes to an address you choose.

## Events

| Event | Fields |
| --- | --- |
| `nightshift.install.started` | `nightshift.install.entry` (`desktop`, `server`, `_OTHER`). `nightshift.install.host` (boolean). |
| `nightshift.agent.checked` | `gen_ai.provider.name`. `nightshift.agent.harness` (`claude-code`, `opencode`, `codex`, `grok-build`, `copilot`, `gemini`, `cursor`, `pi`, `_OTHER`). `nightshift.agent.installed` (boolean). `nightshift.agent.signed_in` (`signed_in`, `signed_out`, `unknown`). |
| `nightshift.project.added` | `nightshift.project.source` (`folder`, `github`, `none` for a project without a folder, `_OTHER`). `nightshift.project.has_remote` (boolean). `nightshift.project.starters` (int). |
| `nightshift.project.checked` | One field per check: `git`, `folder`, `commit`, `identity`, `tools`. Each is `ok`, `failed` or `skipped`. |
| `nightshift.flow.created` | `nightshift.flow.from` (`starter`, `blank`, `import`, `copy`, `_OTHER`). `nightshift.flow.starter` when the flow comes from a starter: its name, or `_OTHER`. |
| `nightshift.schedule.changed` | `nightshift.schedule.enabled`, `nightshift.schedule.webhook` and `nightshift.schedule.score_pull_requests` (booleans). |
| `nightshift.schedule.fired` | No fields. |
| `nightshift.schedule.skipped` | `nightshift.schedule.skip_reason` (`missed`, `paused`, `still_open`, `_OTHER`). |
| `nightshift.run.ended` | `nightshift.flow.id`. `nightshift.run.status`. `nightshift.run.trigger`. `nightshift.run.end_reason`. `nightshift.run.duration` (seconds). `nightshift.run.cost_usd`. `nightshift.run.node_kinds`. Optional `nightshift.run.needed_you` (boolean): a person answered a Gate or an Ask, resumed, stopped or took over the run. |
| `nightshift.step.ended` | `nightshift.node.kind`. `nightshift.step.result` (`pass`, `error`, `stopped`, `interrupted`, `_OTHER`). `nightshift.step.visit`. Optional token counts, `nightshift.cost.basis`, `nightshift.model.family`, `nightshift.step.guard` and `error.type`. |
| `nightshift.gate.answered` | `nightshift.gate.by` (`person`, `deadline`). `nightshift.gate.via` (`web`, `phone`, `lock_screen`, `_OTHER`). `nightshift.gate.wait` (seconds). `nightshift.gate.has_deadline` and `nightshift.gate.is_form` (booleans). |
| `nightshift.run.scored` | `nightshift.run.id` (a hash). `nightshift.score.name` (`gate_decision`, `useful`, `pr_merged`, `pr_closed`, `reverted_within_7d`, `_OTHER`). `nightshift.score.value` (1 for yes, 0 for no). Optional `nightshift.score.hours`: for a pull request score, the hours from when the run opened it. |
| `nightshift.install.active` | `os.type`. `host.arch`. `service.version`. `nightshift.install.spaces` and `nightshift.install.members` (`0`, `1`, `2-4`, `5+`). `nightshift.install.agents` (int). `nightshift.host.paired` and `nightshift.phone.signed_in` (booleans). |
| `nightshift.knowledge.document_measured` | `nightshift.project.id` (a hash). `nightshift.knowledge.document.kilobytes` (int). |
| `nightshift.process.crashed` | `error.type`. |

`useful` is a person's answer to "Was this run useful?". A schedule that scores pull requests sends `pr_merged`, `pr_closed` and `reverted_within_7d`. Night Shift does not send a score that a flow names itself as usage.

## Retired events

An older build still sends these events. The ingest accepts them while such a build sends them ([ADR 24](adr/0024-a-retired-usage-name-stays-accepted-while-old-builds-send-it.md)). A newer build sends `nightshift.run.scored` instead.

| Event | Fields | A newer build sends |
| --- | --- | --- |
| `nightshift.pull_request.opened` | `nightshift.run.id` (a hash). | Nothing. |
| `nightshift.pull_request.outcome` | `nightshift.pull_request.outcome` (`merged`, `closed`, `reverted`, `_OTHER`). `nightshift.pull_request.hours`. | `pr_merged`, `pr_closed` or `reverted_within_7d`. |
| `nightshift.pull_request.useful` | `nightshift.run.id` (a hash). `nightshift.pull_request.useful` (boolean). | `useful`, with 1 or 0. |

## End reasons

`nightshift.run.end_reason` is one of `finished`, `guard.budget`, `guard.turns`, `guard.looping`, `guard.idle`, `guard.max_steps`, `stop_time`, `agent.usage_limit`, `agent.network`, `agent.signed_out`, `stopped_by_person` or `_OTHER`.

## Model families

`nightshift.model.family` is one of `claude-sonnet`, `claude-opus`, `claude-haiku`, `gpt-5`, `gemini`, `grok` or `_OTHER`.

The names and the schemas are generated from `packages/telemetry/registry` into `@nightshift/semconv`.
