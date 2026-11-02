import type { Database } from "@nightshift/db";
import type { Engine, LandedFact, UsageMoment } from "@nightshift/engine";
import type {
	ConnectionStore,
	SettingsStore,
	TelemetryProtocol,
} from "@nightshift/engine/device-config";

import {
	type ExportSinks,
	type ExportTarget,
	otlpSinks,
	type RunningExport,
	startExport,
} from "./otlp";
import { traceRequests } from "./requests";
import {
	assertConforms,
	createRunProjection,
	type RunProjection,
} from "./runs";
import { claudeCodeEnv, codexSession } from "./sessions";
import type { UsageSnapshot } from "./usage";
import { createUsage, parseUsageEvent, sampleUsageEvent } from "./usage";

/**
 * The export to monitoring of this computer, composed: off by default, on
 * with one setting. While it is on, the runs this computer walks go out as
 * OpenTelemetry spans and metrics (`runs/`), the Claude Code and Codex
 * sessions of their steps send their own telemetry to the same place
 * (`sessions/`), and each API request is a trace of its own (`requests/`).
 * Nothing is created while it is off: no provider, no exporter, no
 * connection. It reads its settings from the settings store and the
 * `${NAME}` references of its headers from the secrets, and starts,
 * changes or stops the export itself when either changes, with no restart.
 * The anonymous usage export is separate. It never uses this endpoint,
 * and a session's own telemetry never uses the usage endpoint.
 */

export type Telemetry = {
	/**
	 * What a run step's harness session adds to its environment, the
	 * secret values in it (the headers' secrets), to take out of the
	 * session's output, and the harness's own `--config` overrides
	 * (Codex's). Nothing while the export is off.
	 */
	sessionEnv(session: { harness: string; runId: string; stepId: string }): {
		env: Record<string, string>;
		values: string[];
		config?: Record<string, string>;
	};
	/**
	 * Sends the runs `engine` walks on this computer while the export is
	 * on. Until it is called, only the sessions' own telemetry goes out.
	 */
	follow(
		engine: Pick<Engine, "onLandedFacts" | "runTrace"> & {
			usageAllowed?: () => Promise<boolean>;
		},
	): void;
	/** Sends what waits, and stops. */
	stop(): Promise<void>;
	/** Notes a moment for the anonymous usage export. */
	note(moment: UsageMoment): void;
	/** The anonymous events still here, and the last batch that left. */
	outbox(): Promise<{ waiting: unknown[]; lastSent: unknown[] }>;
	/** The usage events and the fields each one can send. */
	catalog(): { events: { name: string; attributes: string[] }[] };
	/** A new install id and a new key. Old ids stop matching. */
	resetId(): Promise<{ ok: true }>;
};

/** `http/protobuf` and `http/json` only. Unset is protobuf. gRPC stays off. */
function otelProtocol(raw: string | undefined): TelemetryProtocol | null {
	const value = (raw ?? "").trim();
	if (value === "" || value === "http/protobuf") return "http/protobuf";
	if (value === "http/json") return "http/json";
	return null;
}

/** `OTEL_EXPORTER_OTLP_HEADERS`: `name=value,…`, values encoded. */
function otelHeaders(raw: string | undefined): Record<string, string> {
	const headers: Record<string, string> = {};
	if (!raw) return headers;
	for (const part of raw.split(",")) {
		const eq = part.indexOf("=");
		if (eq <= 0) continue;
		const name = part.slice(0, eq).trim();
		if (!name) continue;
		try {
			headers[name] = decodeURIComponent(part.slice(eq + 1).trim());
		} catch {
			headers[name] = part.slice(eq + 1).trim();
		}
	}
	return headers;
}

/** The export as the settings and the secrets have it now. */
type Wanted =
	| { on: false }
	| { on: true; target: ExportTarget; values: string[] };

/**
 * Starts the export to monitoring as the settings have it, and keeps it in
 * step with them. Resolves once the first start is done.
 */
export async function createTelemetry(deps: {
	/** This computer's Device: the Walker whose runs go out. */
	deviceId: string;
	settings: Pick<SettingsStore, "current" | "onChange">;
	/** Where the `${NAME}` references of the headers get their values. */
	secrets: Pick<ConnectionStore, "expandEnv" | "onSecretsChange">;
	/** Where spans and points go. Default: OTLP to the target. A test gives in-memory exporters. */
	sinks?: (target: ExportTarget) => ExportSinks;
	/** How often metrics go out. Default 60 s. */
	metricIntervalMs?: number;
	/** The local database: the usage outbox lives here. */
	db: Database;
	/** Counts for the daily usage event. Null until the daemon can read them. */
	usageSnapshot?: () => Promise<UsageSnapshot | null>;
}): Promise<Telemetry> {
	const sinks = deps.sinks ?? otlpSinks;
	let engine: Pick<Engine, "onLandedFacts" | "runTrace"> | null = null;
	let unfollow = () => {};
	let current: {
		key: string;
		target: ExportTarget;
		values: string[];
		running: RunningExport;
		projection: RunProjection;
		untraceRequests: () => void;
	} | null = null;
	/** Changes and landings go one at a time, in order. */
	let queue: Promise<void> = Promise.resolve();
	const enqueue = (work: () => Promise<void>) => {
		const next = queue.then(work).catch((error: unknown) => {
			console.warn("[telemetry] the export to monitoring failed:", error);
		});
		queue = next;
		return next;
	};

	/** Where the export goes now, with the secrets of its headers read. */
	async function wanted(): Promise<Wanted> {
		if (process.env.OTEL_SDK_DISABLED === "true") return { on: false };
		const s = deps.settings.current();
		// The Night Shift switch wins. An OTEL endpoint does not turn it on.
		if (!s.telemetry) return { on: false };
		const saved = s.telemetryEndpoint.trim();
		if (saved !== "") {
			const headers = await deps.secrets.expandEnv(s.telemetryHeaders);
			if (!headers.ok) {
				console.warn(
					`[telemetry] the export to monitoring stays off: its headers need the secrets ${headers.missing.join(", ")}.`,
				);
				return { on: false };
			}
			return {
				on: true,
				target: {
					endpoint: saved,
					protocol: s.telemetryProtocol,
					headers: headers.env,
				},
				values: headers.values,
			};
		}
		const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "").trim();
		const protocol = otelProtocol(process.env.OTEL_EXPORTER_OTLP_PROTOCOL);
		if (endpoint === "" || !protocol) return { on: false };
		const headers = otelHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);
		return {
			on: true,
			target: { endpoint, protocol, headers },
			values: Object.values(headers),
		};
	}

	async function apply(): Promise<void> {
		const next = await wanted();
		const key = next.on ? JSON.stringify(next.target) : "";
		if ((current?.key ?? "") === key) return;
		const before = current;
		current = null;
		before?.untraceRequests();
		await before?.running.shutdown();
		if (!next.on) return;
		const running = startExport(sinks(next.target), {
			deviceId: deps.deviceId,
			metricIntervalMs: deps.metricIntervalMs,
		});
		current = {
			key,
			target: next.target,
			values: next.values,
			running,
			projection: createRunProjection({
				running,
				read: async (runId) => (engine ? engine.runTrace(runId) : null),
				deviceId: deps.deviceId,
			}),
			untraceRequests: traceRequests(running.tracerProvider),
		};
	}

	// A valid usage event, and an empty export. A broken schema fails here.
	parseUsageEvent(sampleUsageEvent());
	assertConforms({ spans: [], metrics: [] });

	const usage = createUsage({
		db: deps.db,
		settings: deps.settings,
		snapshot: deps.usageSnapshot,
	});

	const reapply = () => void enqueue(apply);
	const offSettings = deps.settings.onChange(reapply);
	const offSecrets = deps.secrets.onSecretsChange(reapply);
	await enqueue(apply);

	return {
		sessionEnv(session) {
			if (!current) return { env: {}, values: [] };
			const ids = {
				runId: session.runId,
				stepId: session.stepId,
				deviceId: deps.deviceId,
			};
			switch (session.harness) {
				case "claude-code":
					return {
						env: claudeCodeEnv(current.target, ids),
						values: current.values,
					};
				case "codex":
					return {
						...codexSession(current.target, ids),
						values: current.values,
					};
				default:
					return { env: {}, values: [] };
			}
		},
		follow(next) {
			unfollow();
			engine = next;
			usage.follow(next);
			// The runs this computer walks: each run's events are written here once.
			unfollow = next.onLandedFacts(
				(facts: readonly LandedFact[]) => {
					void usage.take(facts, (runId) => next.runTrace(runId));
					if (!current) return;
					void enqueue(async () => {
						await current?.projection.take(facts);
					});
				},
				{ only: deps.deviceId },
			);
		},
		async stop() {
			offSettings();
			offSecrets();
			unfollow();
			await usage.stop();
			await queue;
			const before = current;
			current = null;
			before?.untraceRequests();
			await before?.running.shutdown();
		},
		note: (moment) => usage.note(moment),
		outbox: () => usage.outbox(),
		catalog: () => usage.catalog(),
		resetId: () => usage.resetId(),
	};
}
