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
	/**
	 * The placed Device's side: its calls and cancels, as they come, until
	 * the signal aborts. `running`: the calls it still serves. A call it
	 * took before and does not name ended there (it restarted, or the call
	 * never reached it): it ends here with an error.
	 */
	take(
		deviceId: string,
		signal: AbortSignal,
		running?: readonly string[],
	): AsyncIterable<WorkDelivery>;
	/**
	 * The placed Device answers a call it took. `done`: the call ended
	 * there. A call of another Device, or one that ended here, is ignored:
	 * false, and the Device stops it.
	 */
	reply(
		deviceId: string,
		input: { id: string; replies: WorkReply[]; done: boolean },
	): boolean;
};

/** A call waiting for its replies. */
type OpenCall = {
	deviceId: string;
	/** A stream of the Device took it. */
	delivered: boolean;
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

export function createWorkHub(
	options: {
		lostAfterMs?: number;
		/** A Device took work again after it had none: it is back. */
		onBack?: (deviceId: string) => void;
	} = {},
): WorkHub {
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
						message: "The device of this step went offline.",
						offline: true,
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
		// Online: a stream is open now. A new step on a Device without one
		// waits for it (`device-offline`); a call already made waits out a
		// short drop.
		online: (deviceId) => (inboxes.get(deviceId)?.streams ?? 0) > 0,

		async *call(deviceId, request, signal) {
			if (!reachable(deviceId)) {
				yield {
					kind: "error",
					message: "The device of this step is offline.",
					offline: true,
				};
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
				delivered: false,
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

		async *take(deviceId, signal, running) {
			const box = inbox(deviceId);
			if (running) {
				const serving = new Set(running);
				for (const [id, call] of calls) {
					if (call.deviceId !== deviceId || !call.delivered) continue;
					if (serving.has(id)) continue;
					calls.delete(id);
					call.push(
						[
							{
								kind: "error",
								message:
									"The device of this step stopped before the step ended.",
								offline: true,
							},
						],
						true,
					);
				}
			}
			const back = box.streams === 0;
			box.streams++;
			if (box.lost) {
				clearTimeout(box.lost);
				box.lost = null;
			}
			if (back) options.onBack?.(deviceId);
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
						const call =
							delivery.kind === "call" ? calls.get(delivery.id) : undefined;
						if (call) call.delivered = true;
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
			if (!call || call.deviceId !== deviceId) return false;
			if (done) calls.delete(id);
			call.push(replies, done);
			return true;
		},
	};
}
