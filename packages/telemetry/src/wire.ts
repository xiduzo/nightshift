import type { Engine, LandedFact } from "@nightshift/engine";
import type {
	ConnectionStore,
	SettingsStore,
} from "@nightshift/engine/device-config";

import {
	type ExportSinks,
	type ExportTarget,
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
 * connection. It reads its settings from the settings store and the
 * `${NAME}` references of its headers from the secrets, and starts,
 * changes or stops the export itself when either changes, with no restart.
 */

export type Telemetry = {
	/**
	 * What a run step's harness session adds to its environment, and the
	 * secret values in it (the headers' secrets), to take out of the
	 * session's output. Nothing while the export is off.
	 */
	sessionEnv(session: { harness: string; runId: string; stepId: string }): {
		env: Record<string, string>;
		values: string[];
	};
	/**
	 * Sends the runs `engine` walks on this computer while the export is
	 * on. Until it is called, only the sessions' own telemetry goes out.
	 */
	follow(engine: Pick<Engine, "onLandedFacts" | "runTrace">): void;
	/** Sends what waits, and stops. */
	stop(): Promise<void>;
};

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
		const s = deps.settings.current();
		const endpoint = s.telemetryEndpoint.trim();
		if (!s.telemetry || endpoint === "") return { on: false };
		const headers = await deps.secrets.expandEnv(s.telemetryHeaders);
		if (!headers.ok) {
			console.warn(
				`[telemetry] the export to monitoring stays off: its headers need the secrets ${headers.missing.join(", ")}.`,
			);
			return { on: false };
		}
		return {
			on: true,
			target: { endpoint, protocol: s.telemetryProtocol, headers: headers.env },
			values: headers.values,
		};
	}

	async function apply(): Promise<void> {
		const next = await wanted();
		const key = next.on ? JSON.stringify(next.target) : "";
		if ((current?.key ?? "") === key) return;
		const before = current;
		current = null;
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
		};
	}

	const reapply = () => void enqueue(apply);
	const offSettings = deps.settings.onChange(reapply);
	const offSecrets = deps.secrets.onSecretsChange(reapply);
	await enqueue(apply);

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
				values: current.values,
			};
		},
		follow(next) {
			unfollow();
			engine = next;
			// The runs this computer walks: each run's events are written here once.
			unfollow = next.onLandedFacts(
				(facts: readonly LandedFact[]) => {
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
			await queue;
			const before = current;
			current = null;
			await before?.running.shutdown();
		},
	};
}
