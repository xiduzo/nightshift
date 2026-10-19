import { randomUUID } from "node:crypto";
import type { WorkDelivery } from "@nightshift/api/context";
import type { WorkRelay, WorkReply } from "@nightshift/engine";

/**
 * The relay's work half on a Host (`devices.work`): the calls of runs this
 * Host walks, for the Devices they are placed on. The Host never dials a
 * Device. A placed Device takes its work over its own Link, as a stream
 * (`take`), runs each call with its own `localDevice` after its own
 * checks, and answers with `reply`. A call the Walker cancels (its signal
 * aborts: a stop, a time budget) goes to the Device as a `cancel`.
 *
 * The hub is in memory: a Host that stops loses its calls, and its runs
 * are recovered like any interrupted run. A Device whose stream drops
 * keeps its calls for `lostAfterMs`; a call it has not finished by then
 * ends with an error here.
 */

export type WorkHub = WorkRelay & {
	/** The placed Device's side: its calls and cancels, as they come, until the signal aborts. */
	take(deviceId: string, signal: AbortSignal): AsyncIterable<WorkDelivery>;
	/**
	 * The placed Device answers a call it took. `done`: the call ended
	 * there. A call of another Device, or one that ended here, is ignored.
	 */
	reply(
		deviceId: string,
		input: { id: string; replies: WorkReply[]; done: boolean },
	): void;
};

/** A call waiting for its replies. */
type OpenCall = {
	deviceId: string;
	push(replies: WorkReply[], done: boolean): void;
};

/** One Device's side of the hub. */
type Inbox = {
	deliveries: WorkDelivery[];
	/** Wakes the Device's streams. */
	wake: Set<() => void>;
	/** Streams open now. The Device takes work while it has one. */
	streams: number;
	/** Fails the Device's calls once it stayed away too long. */
	lost: Timer | null;
};

export function createWorkHub(options: { lostAfterMs?: number } = {}): WorkHub {
	const lostAfterMs = options.lostAfterMs ?? 45_000;
	const inboxes = new Map<string, Inbox>();
	const calls = new Map<string, OpenCall>();

	function inbox(deviceId: string): Inbox {
		let found = inboxes.get(deviceId);
		if (!found) {
			found = { deliveries: [], wake: new Set(), streams: 0, lost: null };
			inboxes.set(deviceId, found);
		}
		return found;
	}

	function deliver(deviceId: string, delivery: WorkDelivery) {
		const box = inbox(deviceId);
		box.deliveries.push(delivery);
		for (const wake of box.wake) wake();
	}

	/** Ends every open call of a Device that went away. */
	function lose(deviceId: string) {
		const box = inbox(deviceId);
		box.lost = null;
		box.deliveries = [];
		for (const [id, call] of calls) {
			if (call.deviceId !== deviceId) continue;
			calls.delete(id);
			call.push(
				[
					{
						kind: "error",
						message: "The device of this run went offline.",
					},
				],
				true,
			);
		}
	}

	/** The Device takes work now, or its stream dropped a moment ago: calls wait for it. */
	function reachable(deviceId: string): boolean {
		const box = inboxes.get(deviceId);
		return box !== undefined && (box.streams > 0 || box.lost !== null);
	}

	return {
		online: reachable,

		async *call(deviceId, request, signal) {
			if (!reachable(deviceId)) {
				yield { kind: "error", message: "The device of this run is offline." };
				return;
			}
			const id = randomUUID();
			const queue: WorkReply[] = [];
			let ended = false;
			let wake: (() => void) | null = null;
			const notify = () => {
				const resolve = wake;
				wake = null;
				resolve?.();
			};
			calls.set(id, {
				deviceId,
				push(replies, done) {
					queue.push(...replies);
					if (done) ended = true;
					notify();
				},
			});
			const cancel = () => {
				if (!calls.delete(id)) return;
				ended = true;
				deliver(deviceId, { kind: "cancel", id });
				notify();
			};
			signal?.addEventListener("abort", cancel, { once: true });
			deliver(deviceId, { kind: "call", id, request });
			try {
				while (true) {
					const reply = queue.shift();
					if (reply) {
						yield reply;
						continue;
					}
					if (ended) return;
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
				}
			} finally {
				signal?.removeEventListener("abort", cancel);
				// The Walker stopped reading before the Device ended it.
				cancel();
			}
		},

		async *take(deviceId, signal) {
			const box = inbox(deviceId);
			box.streams++;
			if (box.lost) {
				clearTimeout(box.lost);
				box.lost = null;
			}
			let wake: (() => void) | null = null;
			const notify = () => {
				const resolve = wake;
				wake = null;
				resolve?.();
			};
			box.wake.add(notify);
			signal.addEventListener("abort", notify, { once: true });
			try {
				while (!signal.aborted) {
					const delivery = box.deliveries.shift();
					if (delivery) {
						yield delivery;
						continue;
					}
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
				}
			} finally {
				box.wake.delete(notify);
				signal.removeEventListener("abort", notify);
				box.streams--;
				if (box.streams === 0) {
					box.lost = setTimeout(() => lose(deviceId), lostAfterMs);
					box.lost.unref?.();
				}
			}
		},

		reply(deviceId, { id, replies, done }) {
			const call = calls.get(id);
			if (!call || call.deviceId !== deviceId) return;
			if (done) calls.delete(id);
			call.push(replies, done);
		},
	};
}
