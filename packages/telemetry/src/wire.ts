import type { Engine, LandedFact } from "@nightshift/engine";

import { type HeaderValues, keptHeaders, parseHeaders } from "./headers";
import {
	type ExportSinks,
	type ExportTarget,
	type OtlpProtocol,
	otlpSinks,
	type RunningExport,
	startExport,
} from "./otlp";
import { createRunProjection, type RunProjection } from "./runs";
import { claudeCodeEnv } from "./sessions";

/**
 * The export to monitoring of this computer, composed: off by default, on
 * with one setting. While it is on, the runs this computer walks go out as
 * OpenTelemetry spans and metrics (`runs/`), and the Claude Code sessions
 * of their steps send their own telemetry to the same place (`sessions/`).
 * Nothing is created while it is off: no provider, no exporter, no
 * connection. `refresh` reads the settings and the headers again, and
 * starts, changes or stops the export to match, with no restart.
 */

/** This computer's settings of the export. */
export type TelemetrySettings = {
	enabled: boolean;
	/** The OTLP endpoint, without `/v1/traces`. Empty: none, so the export stays off. */
	endpoint: string;
	protocol: OtlpProtocol;
};

export type Telemetry = {
	/**
	 * What a run step's harness session adds to its environment, and the
	 * secret values in it (the headers' values), to take out of the
	 * session's output. Nothing while the export is off.
	 */
	sessionEnv(session: { harness: string; runId: string; stepId: string }): {
		env: Record<string, string>;
		values: string[];
	};
	/** The export's headers: their names only, never their values. */
	headers: {
		names(): Promise<string[]>;
		/**
		 * Keeps the headers a person wrote (`name=value`, one per line) in
		 * place of the ones before, and uses them at once. Null or empty:
		 * forgets them. Returns their names.
		 */
		save(text: string | null): Promise<string[]>;
	};
	/** Reads the settings and headers again, and starts, changes or stops the export to match. */
	refresh(): Promise<void>;
	/** Whether the export is on now. */
	active(): boolean;
	/** Sends what waits, and stops. */
	stop(): Promise<void>;
};

export function createTelemetry(deps: {
	engine: Pick<Engine, "onLandedFacts" | "runTrace">;
	/** This computer's Device: the Walker whose runs go out. */
	deviceId: string;
	settings: () => TelemetrySettings;
	/** Where the headers are kept: the keychain, else a file. */
	values: HeaderValues;
	/** Where spans and points go. Default: OTLP to the target. A test gives in-memory exporters. */
	sinks?: (target: ExportTarget) => ExportSinks;
	/** How often metrics go out. Default 60 s. */
	metricIntervalMs?: number;
}): Telemetry {
	const kept = keptHeaders(deps.values);
	const sinks = deps.sinks ?? otlpSinks;
	let headers: Record<string, string> = {};
	let headersRead = false;
	let current: {
		key: string;
		target: ExportTarget;
		running: RunningExport;
		projection: RunProjection;
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

	/** Where the export goes now, or null while it is off. */
	function target(): ExportTarget | null {
		const s = deps.settings();
		const endpoint = s.endpoint.trim();
		if (!s.enabled || endpoint === "") return null;
		return { endpoint, protocol: s.protocol, headers };
	}

	async function readHeaders(): Promise<void> {
		if (headersRead) return;
		headers = await kept.read();
		headersRead = true;
	}

	async function apply(): Promise<void> {
		// The keychain is read only once the export is wanted.
		if (target() !== null) await readHeaders();
		const wanted = target();
		const key = wanted ? JSON.stringify(wanted) : "";
		if ((current?.key ?? "") === key) return;
		const before = current;
		current = null;
		await before?.running.shutdown();
		if (!wanted) return;
		const running = startExport(sinks(wanted), {
			deviceId: deps.deviceId,
			metricIntervalMs: deps.metricIntervalMs,
		});
		current = {
			key,
			target: wanted,
			running,
			projection: createRunProjection({
				running,
				read: (runId) => deps.engine.runTrace(runId),
				deviceId: deps.deviceId,
			}),
		};
	}

	// The runs this computer walks: each run's events are written here once.
	const off = deps.engine.onLandedFacts(
		(facts: readonly LandedFact[]) => {
			if (!current) return;
			void enqueue(async () => {
				await current?.projection.take(facts);
			});
		},
		{ only: deps.deviceId },
	);

	return {
		sessionEnv(session) {
			if (!current || session.harness !== "claude-code")
				return { env: {}, values: [] };
			return {
				env: claudeCodeEnv(current.target, {
					runId: session.runId,
					stepId: session.stepId,
					deviceId: deps.deviceId,
				}),
				values: Object.values(current.target.headers),
			};
		},
		headers: {
			async names() {
				await readHeaders();
				return Object.keys(headers);
			},
			async save(text) {
				const next = text?.trim() ? parseHeaders(text) : {};
				await kept.write(next);
				headers = next;
				headersRead = true;
				await enqueue(apply);
				return Object.keys(next);
			},
		},
		refresh: () => enqueue(apply),
		active: () => current !== null,
		async stop() {
			off();
			await queue;
			const before = current;
			current = null;
			await before?.running.shutdown();
		},
	};
}
