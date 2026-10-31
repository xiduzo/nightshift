import { ATTR, stepTraceparent } from "../conventions";
import type { ExportTarget } from "../otlp";

/**
 * What a Claude Code session of a run step gets in its environment while
 * the export is on: its own telemetry (`claude_code.cost.usage`,
 * `api_request`, its session trace) to the same endpoint, tagged with the
 * run and the step, and the step's span as its parent (`TRACEPARENT`), so
 * it lands in the same backend under the step. What the person wrote, the
 * tool inputs and the replies stay out: each of those switches is set off,
 * whatever this computer's own environment says.
 *
 * The headers go in `OTEL_EXPORTER_OTLP_HEADERS`, which Claude Code's
 * exporter reads. The commands Claude Code runs (Bash, hooks, MCP servers)
 * do not inherit its `OTEL_*` variables from 2.1.128 on (checked on
 * 2.1.316: Bash sees none of them). The harness leaves the headers out
 * for an older Claude Code, and a Command step never gets this
 * environment at all.
 *
 * Codex sessions get their telemetry too (`codexSession`). OpenCode, pi,
 * the ACP agents and Grok Build get nothing: the engine's own spans and
 * metrics cover them.
 */

/** OTLP headers as `OTEL_EXPORTER_OTLP_HEADERS` writes them: `name=value,…`, values encoded. */
export function headersVariable(
	headers: Readonly<Record<string, string>>,
): string {
	return Object.entries(headers)
		.map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
		.join(",");
}

/** `OTEL_RESOURCE_ATTRIBUTES`: `key=value,…`, values encoded. */
function resourceVariable(attributes: Record<string, string>): string {
	return Object.entries(attributes)
		.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
		.join(",");
}

type Session = { runId: string; stepId: string; deviceId: string };

/** The run, the step and the Device, as every session's resource names them. */
function sessionResource(session: Session): string {
	return resourceVariable({
		[ATTR.runId]: session.runId,
		[ATTR.stepId]: session.stepId,
		[ATTR.deviceId]: session.deviceId,
	});
}

/** The environment of a Claude Code session of `runId`'s step `stepId`. */
export function claudeCodeEnv(
	target: ExportTarget,
	session: Session,
): Record<string, string> {
	const headers = headersVariable(target.headers);
	return {
		CLAUDE_CODE_ENABLE_TELEMETRY: "1",
		OTEL_METRICS_EXPORTER: "otlp",
		OTEL_LOGS_EXPORTER: "otlp",
		// Claude Code's session trace: its spans hang under the step's.
		CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
		OTEL_TRACES_EXPORTER: "otlp",
		OTEL_EXPORTER_OTLP_PROTOCOL: target.protocol,
		OTEL_EXPORTER_OTLP_ENDPOINT: target.endpoint.replace(/\/+$/, ""),
		...(headers ? { OTEL_EXPORTER_OTLP_HEADERS: headers } : {}),
		OTEL_RESOURCE_ATTRIBUTES: sessionResource(session),
		TRACEPARENT: stepTraceparent(session.runId, session.stepId),
		// Content stays on this computer.
		OTEL_LOG_USER_PROMPTS: "0",
		OTEL_LOG_ASSISTANT_RESPONSES: "0",
		OTEL_LOG_TOOL_DETAILS: "0",
		OTEL_LOG_TOOL_CONTENT: "0",
	};
}

/** Codex's name for an OTLP/HTTP protocol. */
const CODEX_PROTOCOL = { "http/protobuf": "binary", "http/json": "json" };

/**
 * What a Codex session of `runId`'s step `stepId` gets while the export is
 * on: its own logs (`codex.api_request`, `codex.tool_result`, ...), metrics
 * and traces to the same endpoint. Codex sets its telemetry in its config,
 * one exporter per signal with the whole path, so the endpoints go in as
 * `--config` overrides (`config`). The headers stay off the command line:
 * Codex's OTLP exporters read `OTEL_EXPORTER_OTLP_HEADERS` from the
 * environment, and the harness keeps `OTEL_*` from the commands Codex runs.
 * What the person wrote stays out (`log_user_prompt = false`).
 *
 * Codex reports tokens, not dollars: the engine prices them, and its
 * `nightshift.run.cost_usd` counts a Codex step as `estimated`. Codex
 * reading `TRACEPARENT` and `OTEL_RESOURCE_ATTRIBUTES` is not verified:
 * without them its spans land in their own trace, with `service.name`
 * `codex_exec`.
 */
export function codexSession(
	target: ExportTarget,
	session: Session,
): { env: Record<string, string>; config: Record<string, string> } {
	const headers = headersVariable(target.headers);
	const base = target.endpoint.replace(/\/+$/, "");
	const protocol = CODEX_PROTOCOL[target.protocol];
	const exporter = (path: string) =>
		`{ otlp-http = { endpoint = ${JSON.stringify(`${base}${path}`)}, protocol = "${protocol}" } }`;
	return {
		env: {
			...(headers ? { OTEL_EXPORTER_OTLP_HEADERS: headers } : {}),
			OTEL_RESOURCE_ATTRIBUTES: sessionResource(session),
			TRACEPARENT: stepTraceparent(session.runId, session.stepId),
		},
		config: {
			"otel.environment": '"nightshift"',
			"otel.log_user_prompt": "false",
			"otel.exporter": exporter("/v1/logs"),
			"otel.trace_exporter": exporter("/v1/traces"),
			"otel.metrics_exporter": exporter("/v1/metrics"),
		},
	};
}
