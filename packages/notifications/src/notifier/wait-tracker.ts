import type { LandedFact } from "@nightshift/engine";

import { deviceWaitKey, parseDeviceWaitKey } from "../contract";

/**
 * The steps that wait for an offline Device, from the landed facts. A step
 * whose Device is offline looks again every minute: its wait ends and
 * starts again at once. So a wait counts as over only when its step does
 * not sleep again within `graceMs`, or at once when the step or the run
 * ends, or the step waits for something else.
 */

/** A step began to wait for a Device. */
export type StartedWait = {
	key: string;
	runId: string;
	stepId: string;
	/** The Device's name, as the Walker said it. Null: a Walker of an older version. */
	deviceName: string | null;
};

/** What a landing did to the device waits of one Space. */
export type WaitChanges = {
	/** Waits that began: tell them. */
	started: StartedWait[];
	/** Waits that are over: take their notifications back. */
	ended: string[];
};

export type WaitTracker = {
	/** What the facts of one Space did. `at`: when they landed. */
	apply(spaceId: string, facts: readonly LandedFact[], at: number): WaitChanges;
	/** The waits whose step did not sleep again within the grace: they are over now. */
	due(at: number): { spaceId: string; key: string }[];
	/** Knows the wait of the key as going on: one the log told before this notifier started. */
	track(spaceId: string, key: string): void;
};

/** How long a step may be awake between two sleeps of one wait. */
export const WAIT_GRACE_MS = 10_000;

type Known = { spaceId: string; runId: string; endedAt: number | null };

export function createWaitTracker(graceMs = WAIT_GRACE_MS): WaitTracker {
	const known = new Map<string, Known>();

	return {
		apply(spaceId, facts, at) {
			const started: StartedWait[] = [];
			const ended: string[] = [];
			/** The waits that began in this batch: one that ends in it was never told. */
			const fresh = new Set<string>();
			const end = (key: string) => {
				if (!known.delete(key)) return;
				if (!fresh.delete(key)) ended.push(key);
			};
			for (const fact of facts) {
				if (fact.kind === "run-ended") {
					for (const [key, wait] of known) {
						if (wait.runId === fact.runId) end(key);
					}
					continue;
				}
				if (
					fact.kind !== "wait-started" &&
					fact.kind !== "wait-ended" &&
					fact.kind !== "step-ended"
				) {
					continue;
				}
				const key = deviceWaitKey({ runId: fact.runId, stepId: fact.stepId });
				const wait = known.get(key);
				if (fact.kind === "wait-started") {
					if (fact.reason !== "device-offline") {
						end(key);
					} else if (wait) {
						wait.endedAt = null;
					} else {
						known.set(key, { spaceId, runId: fact.runId, endedAt: null });
						fresh.add(key);
						started.push({
							key,
							runId: fact.runId,
							stepId: fact.stepId,
							deviceName: fact.deviceName,
						});
					}
				} else if (fact.kind === "wait-ended") {
					if (wait) wait.endedAt = at;
				} else {
					end(key);
				}
			}
			return {
				started: started.filter((wait) => fresh.has(wait.key)),
				ended,
			};
		},

		due(at) {
			const due: { spaceId: string; key: string }[] = [];
			for (const [key, wait] of known) {
				if (wait.endedAt === null || at - wait.endedAt < graceMs) continue;
				known.delete(key);
				due.push({ spaceId: wait.spaceId, key });
			}
			return due;
		},

		track(spaceId, key) {
			const wait = parseDeviceWaitKey(key);
			if (!wait || known.has(key)) return;
			known.set(key, { spaceId, runId: wait.runId, endedAt: null });
		},
	};
}
