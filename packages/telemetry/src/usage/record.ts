import { randomBytes, randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import type { LandedFact, RunTrace, UsageMoment } from "@nightshift/engine";
import { now as clockNow, dayKey } from "@nightshift/time";
import { hostArch, osType } from "../otlp";
import { usageCatalog } from "./catalog";
import { momentEvent, runEndedEvent, stepEndedEvent } from "./events";
import {
	insertIdentity,
	keepEvent,
	lastSentEvents,
	markActiveDay,
	readIdentity,
	rememberSent,
	removeEvents,
	replaceIdentity,
	waitingEvents,
} from "./outbox";
import {
	chunkEvents,
	otlpUsageTransport,
	type UsageTransport,
	usageEndpoint,
} from "./send";

/** How often a batch may leave, apart from a stop. */
const USAGE_INTERVAL_MS = 15 * 60 * 1000;

export type UsageSnapshot = {
	agents: number;
	phone: boolean;
	paired: boolean;
	spaces: number;
	members: number;
};

export type UsageExport = {
	note(moment: UsageMoment): void;
	take(
		facts: readonly LandedFact[],
		read: (runId: string) => Promise<RunTrace | null>,
	): Promise<void>;
	/** Reads whether any Space turns usage off, and stores the daily event. */
	follow(engine: { usageAllowed?: () => Promise<boolean> }): void;
	/** Sends what waits, even inside the 15 minute gap, and stops the timer. */
	stop(): Promise<void>;
	/** Sends what waits, at most once per interval. */
	flush(): Promise<void>;
	settled(): Promise<void>;
	outbox(): Promise<{ waiting: unknown[]; lastSent: unknown[] }>;
	catalog(): { events: { name: string; attributes: string[] }[] };
	resetId(): Promise<{ ok: true }>;
};

function envIs(name: string, expected: string): boolean {
	return process.env[name]?.trim().toLowerCase() === expected;
}

function usageChoice(): boolean | undefined {
	const value = process.env.NIGHTSHIFT_USAGE?.trim().toLowerCase();
	if (value === "on" || value === "true" || value === "1") return true;
	if (value === "off" || value === "false" || value === "0") return false;
	return undefined;
}

/** DO_NOT_TRACK, the usage env off, or the OpenTelemetry kill switch. */
function blocked(): boolean {
	return (
		envIs("DO_NOT_TRACK", "1") ||
		envIs("OTEL_SDK_DISABLED", "true") ||
		usageChoice() === false
	);
}

function platform(): { os: string; arch: string; version: string } {
	return {
		os: osType(),
		arch: hostArch(),
		version: process.env.NIGHTSHIFT_VERSION?.trim() || "dev",
	};
}

/**
 * The anonymous usage export. Events are anonymized before they are stored.
 * Nothing is sent while usage is off, a Space turns it off, an environment
 * lock is set, the person has not seen the notice, or no endpoint is set.
 * An explicit usage env of on does not wait for the notice.
 */
export function createUsage(deps: {
	db: Database;
	settings: {
		current(): { usage: boolean; usageSeen: boolean };
		onChange?(listener: () => void): () => void;
	};
	/** Whether every Space this computer belongs to allows usage. */
	policy?: () => Promise<boolean>;
	/** The daily event's counts. Null until the daemon can read them. */
	snapshot?: () => Promise<UsageSnapshot | null>;
	/** Where batches go. Default: OTLP JSON at usageEndpoint(), or nowhere. */
	transport?: UsageTransport;
	now?: () => number;
	intervalMs?: number;
	maxBody?: number;
}): UsageExport {
	const now = deps.now ?? clockNow;
	const interval = deps.intervalMs ?? USAGE_INTERVAL_MS;
	let policy = deps.policy ?? (async () => false);
	let lastSentAt = 0;
	const opened = new Set<string>();
	let queue: Promise<void> = Promise.resolve();

	const enqueue = (work: () => Promise<void>): Promise<void> => {
		const next = queue.then(work).catch((error: unknown) => {
			console.warn("[telemetry] usage was not stored:", error);
		});
		queue = next;
		return next;
	};

	function transport(): UsageTransport | null {
		if (deps.transport) return deps.transport;
		const endpoint = usageEndpoint();
		if (endpoint === "") return null;
		return otlpUsageTransport(endpoint);
	}

	async function spacesAllow(): Promise<boolean> {
		try {
			return await policy();
		} catch (error) {
			console.warn("[telemetry] usage stays on this computer:", error);
			return false;
		}
	}

	async function mayRecord(): Promise<boolean> {
		if (!deps.settings.current().usage) return false;
		if (blocked()) return false;
		return spacesAllow();
	}

	async function maySend(): Promise<boolean> {
		if (!(await mayRecord())) return false;
		if (!deps.settings.current().usageSeen && usageChoice() !== true)
			return false;
		return transport() !== null;
	}

	/** The key of the row, created only when an event is about to be stored. */
	async function store(
		build: (key: string) => Record<string, unknown> | null,
	): Promise<boolean> {
		if (!(await mayRecord())) return false;
		const existing = await readIdentity(deps.db);
		const fresh = existing
			? null
			: { installId: randomUUID(), hmacKey: randomBytes(32).toString("hex") };
		const key = existing?.hmacKey ?? fresh?.hmacKey;
		if (!key) return false;
		let event = build(key);
		if (!event) return false;
		if (fresh) {
			await insertIdentity(deps.db, fresh);
			const winner = await readIdentity(deps.db);
			if (winner && winner.hmacKey !== key) {
				event = build(winner.hmacKey);
				if (!event) return false;
			}
		}
		return keepEvent(deps.db, event, now(), now());
	}

	async function considerActive(): Promise<void> {
		if (!deps.snapshot) return;
		if (!(await mayRecord())) return;
		const day = dayKey(now(), "UTC");
		const identity = await readIdentity(deps.db);
		if (identity?.activeOn === day) return;
		const snap = await deps.snapshot();
		if (!snap) return;
		const stored = await store((key) =>
			momentEvent({ kind: "install-active", ...snap }, key, platform()),
		);
		if (stored) await markActiveDay(deps.db, day);
	}

	async function sendWaiting(force: boolean): Promise<void> {
		if (!force && now() - lastSentAt < interval) return;
		if (!(await maySend())) return;
		const sender = transport();
		if (!sender) return;
		const waiting = await waitingEvents(deps.db);
		if (waiting.length === 0) return;
		const identity = await readIdentity(deps.db);
		if (!identity) return;
		let sent = false;
		for (const chunk of chunkEvents(waiting, deps.maxBody)) {
			await sender.send(chunk, identity.installId);
			await removeEvents(
				deps.db,
				chunk.map((item) => item.id),
			);
			await rememberSent(
				deps.db,
				chunk.map((item) => item.event),
				now(),
			);
			sent = true;
		}
		if (sent) lastSentAt = now();
	}

	const timer = setInterval(() => {
		void enqueue(async () => {
			await considerActive();
			await sendWaiting(false);
		});
	}, interval);
	timer.unref?.();
	const offSettings = deps.settings.onChange?.(() => {
		void enqueue(() => sendWaiting(false));
	});

	return {
		note(moment) {
			void enqueue(async () => {
				if (moment.kind === "pull-request-opened" && opened.has(moment.runId))
					return;
				const stored = await store((key) =>
					momentEvent(moment, key, platform()),
				);
				if (stored && moment.kind === "pull-request-opened")
					opened.add(moment.runId);
			});
		},
		take(facts, read) {
			return enqueue(async () => {
				for (const fact of facts) {
					if (fact.kind !== "run-ended" && fact.kind !== "step-ended") continue;
					const trace = await read(fact.runId);
					if (!trace) continue;
					await store((key) =>
						fact.kind === "run-ended"
							? runEndedEvent(fact, trace, key)
							: stepEndedEvent(fact, trace, key),
					);
				}
			});
		},
		follow(engine) {
			policy = () => engine.usageAllowed?.() ?? Promise.resolve(true);
			void enqueue(() => considerActive());
		},
		flush() {
			return enqueue(() => sendWaiting(false));
		},
		async stop() {
			clearInterval(timer);
			offSettings?.();
			await enqueue(() => sendWaiting(true));
		},
		settled() {
			return queue;
		},
		async outbox() {
			await queue;
			return {
				waiting: (await waitingEvents(deps.db)).map((item) => item.event),
				lastSent: await lastSentEvents(deps.db),
			};
		},
		catalog: usageCatalog,
		resetId() {
			return enqueue(async () => {
				opened.clear();
				await replaceIdentity(deps.db);
			}).then(() => ({ ok: true as const }));
		},
	};
}
