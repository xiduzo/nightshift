import { deviceWaitKey, parseDeviceWaitKey } from "../contract";
import type { RunEvent } from "./sources";

/**
 * The steps that wait for an offline Device, from the run events. A step
 * whose Device is offline looks again every minute: its sleep ends
 * (`WaitEnded`) and starts again (`WaitStarted`) at once. So a wait counts
 * as over only when its step does not sleep again within `graceMs`, or at
 * once when the step or the run ends, or the step waits for something
 * else.
 */

/** A step began to wait for a Device. */
export type StartedWait = {
	key: string;
	runId: string;
	stepId: string;
	/** The Device's name, as the Walker said it. Null: a Walker of an older version. */
	deviceName: string | null;
};

/** What a batch of run events did to the device waits of one Space. */
export type WaitChanges = {
	/** Waits that began: tell them. */
	started: StartedWait[];
	/** Waits that are over: take their notifications back. */
	ended: string[];
};

export type WaitTracker = {
	/** What the events of one Space did. `at`: when they landed. */
	apply(spaceId: string, events: readonly RunEvent[], at: number): WaitChanges;
	/** The waits whose step did not sleep again within the grace: they are over now. */
	due(at: number): { spaceId: string; key: string }[];
	/** Knows the wait of the key as going on: one the log told before this notifier started. */
	track(spaceId: string, key: string): void;
};

/** How long a step may be awake between two sleeps of one wait. */
export const WAIT_GRACE_MS = 10_000;

type Known = { spaceId: string; runId: string; endedAt: number | null };

/** The payload of a `WaitStarted`, as far as a device wait needs it. */
type WaitPayload = { reason?: unknown; deviceName?: unknown };

export function createWaitTracker(graceMs = WAIT_GRACE_MS): WaitTracker {
	const known = new Map<string, Known>();

	return {
		apply(spaceId, events, at) {
			const started: StartedWait[] = [];
			const ended: string[] = [];
			/** The waits that began in this batch: one that ends in it was never told. */
			const fresh = new Set<string>();
			const end = (key: string) => {
				if (!known.delete(key)) return;
				if (!fresh.delete(key)) ended.push(key);
			};
			for (const event of events) {
				if (event.type === "RunEnded") {
					for (const [key, wait] of known) {
						if (wait.runId === event.runId) end(key);
					}
					continue;
				}
				if (event.stepId === null) continue;
				const key = deviceWaitKey({
					runId: event.runId,
					stepId: event.stepId,
				});
				const wait = known.get(key);
				if (event.type === "WaitStarted") {
					const payload = (event.payload ?? {}) as WaitPayload;
					if (payload.reason !== "device-offline") {
						end(key);
					} else if (wait) {
						wait.endedAt = null;
					} else {
						known.set(key, { spaceId, runId: event.runId, endedAt: null });
						fresh.add(key);
						started.push({
							key,
							runId: event.runId,
							stepId: event.stepId,
							deviceName:
								typeof payload.deviceName === "string" &&
								payload.deviceName !== ""
									? payload.deviceName
									: null,
						});
					}
				} else if (event.type === "WaitEnded" && wait) {
					wait.endedAt = at;
				} else if (event.type === "StepEnded") {
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
