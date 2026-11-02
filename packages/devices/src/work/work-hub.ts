import { randomUUID } from "node:crypto";
import type { WorkDelivery, WorkRelay, WorkReply } from "../contract";
import { OFFLINE_AFTER_MS } from "../registry";

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
 * keeps its calls for `lostAfterMs` (by default `OFFLINE_AFTER_MS`, the
 * window after which the registry says it is offline too); a call it has
 * not finished by then ends with an error here.
 *
 * A call must not go to a stream nobody reads. A daemon that restarts, or
 * a connection that dies without a close, can leave its old stream open
 * here, and a call that stream takes is never served. Two rules guard
 * against that:
 *
 * - **The newest stream wins.** A Device takes its work over one stream.
 *   When it opens a new one, the older ones end, and the calls they took
 *   that the Device has not answered and does not name in `running` go to
 *   the new stream.
 * - **A taken call is confirmed.** A Device of this version answers each
 *   call it takes at once with an empty batch of replies (an ack). When a
 *   Device that acks leaves a call without one for `ackMs`, its stream is
 *   dead: that stream ends, and the call waits for the next one. A Device
 *   of an older version never acks, so nothing waits for its acks.
 */

/** How long a Device that acks its calls may take to ack one before its stream counts as dead. */
export const ACK_MS = 15_000;

export type WorkHub = WorkRelay & {
	/**
	 * The placed Device's side: its calls and cancels, as they come, until
	 * the signal aborts or a newer stream of the same Device opens.
	 * `running`: the calls it still serves. A call it took before and does
	 * not name ended there (it restarted, or the call never reached it): a
	 * call it already answered ends here with an error, and one it never
	 * answered goes to this stream again.
	 */
	take(
		deviceId: string,
		signal: AbortSignal,
		running?: readonly string[],
	): AsyncIterable<WorkDelivery>;
	/**
	 * The placed Device answers a call it took. `done`: the call ended
	 * there. An empty batch that is not `done` is its ack. A call of
	 * another Device, or one that ended here, is ignored: false, and the
	 * Device stops it.
	 */
	reply(
		deviceId: string,
		input: { id: string; replies: WorkReply[]; done: boolean },
	): boolean;
};

/** One stream a Device takes its work over. */
type Stream = {
	/** Ends the stream: a newer one opened, or it left a call without an ack. */
	end: AbortController;
	/** It stopped counting as one of the Device's streams. */
	left: boolean;
};

/** A call waiting for its replies. */
type OpenCall = {
	deviceId: string;
	request: WorkDelivery & { kind: "call" };
	/** The stream that took it, while it is out there. Null while it waits in the inbox. */
	takenBy: Stream | null;
	/** The Device answered it: an ack or a reply. */
	answered: boolean;
	/** Ends the stream that took it when no ack comes. */
	ackTimer: Timer | null;
	push(replies: WorkReply[], done: boolean): void;
};

/** One Device's side of the hub. */
type Inbox = {
	deliveries: WorkDelivery[];
	/** Wakes the Device's streams. */
	wake: Set<() => void>;
	/** Streams open now. The Device takes work while it has one. */
	streams: Set<Stream>;
	/** The Device acks the calls it takes (it runs this version or newer). */
	acks: boolean;
	/** Fails the Device's calls once it stayed away too long. */
	lost: Timer | null;
};

export function createWorkHub(
	options: {
		lostAfterMs?: number;
		/** How long an acking Device may take to ack a call. Default `ACK_MS`. */
		ackMs?: number;
		/** A Device took work again after it had none: it is back. */
		onBack?: (deviceId: string) => void;
	} = {},
): WorkHub {
	const lostAfterMs = options.lostAfterMs ?? OFFLINE_AFTER_MS;
	const ackMs = options.ackMs ?? ACK_MS;
	const inboxes = new Map<string, Inbox>();
	const calls = new Map<string, OpenCall>();

	function inbox(deviceId: string): Inbox {
		let found = inboxes.get(deviceId);
		if (!found) {
			found = {
				deliveries: [],
				wake: new Set(),
				streams: new Set(),
				acks: false,
				lost: null,
			};
			inboxes.set(deviceId, found);
		}
		return found;
	}

	function wakeAll(box: Inbox) {
		for (const wake of box.wake) wake();
	}

	function deliver(deviceId: string, delivery: WorkDelivery) {
		const box = inbox(deviceId);
		box.deliveries.push(delivery);
		wakeAll(box);
	}

	function stopAckTimer(call: OpenCall) {
		if (call.ackTimer) clearTimeout(call.ackTimer);
		call.ackTimer = null;
	}

	/** A call that left with a stream nobody reads waits for the next one, first in line. */
	function redeliver(call: OpenCall) {
		stopAckTimer(call);
		call.takenBy = null;
		const box = inbox(call.deviceId);
		box.deliveries.unshift(call.request);
		wakeAll(box);
	}

	/** Ends every open call of a Device that went away. */
	function lose(deviceId: string) {
		const box = inbox(deviceId);
		box.lost = null;
		box.deliveries = [];
		for (const [id, call] of calls) {
			if (call.deviceId !== deviceId) continue;
			calls.delete(id);
			stopAckTimer(call);
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

	/** The stream no longer counts. The Device's calls wait `lostAfterMs` when it was the last. */
	function leave(deviceId: string, stream: Stream) {
		if (stream.left) return;
		stream.left = true;
		const box = inbox(deviceId);
		box.streams.delete(stream);
		if (box.streams.size === 0 && !box.lost) {
			box.lost = setTimeout(() => lose(deviceId), lostAfterMs);
			box.lost.unref?.();
		}
	}

	/** The Device takes work now, or its stream dropped a moment ago: calls wait for it. */
	function reachable(deviceId: string): boolean {
		const box = inboxes.get(deviceId);
		return box !== undefined && (box.streams.size > 0 || box.lost !== null);
	}

	return {
		// Online: it takes work now, a stream is open (for placement and
		// `reachable`). Its Link keeps the stream open while it is online, so
		// this differs from the registry's `online` (its Link answers) only
		// while the stream backs off after a failure, and for the window after
		// a drop. A new step on a Device without a stream waits for it
		// (`device-offline`); a call already made waits out a short drop.
		online: (deviceId) => (inboxes.get(deviceId)?.streams.size ?? 0) > 0,

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
			const delivery = { kind: "call", id, request } as const;
			const open: OpenCall = {
				deviceId,
				request: delivery,
				takenBy: null,
				answered: false,
				ackTimer: null,
				push(replies, done) {
					queue.push(...replies);
					if (done) ended = true;
					notify();
				},
			};
			calls.set(id, open);
			const cancel = () => {
				if (!calls.delete(id)) return;
				stopAckTimer(open);
				ended = true;
				const box = inbox(deviceId);
				const waiting = box.deliveries.indexOf(delivery);
				// Never taken: the Device does not need to hear of it.
				if (waiting >= 0) box.deliveries.splice(waiting, 1);
				else deliver(deviceId, { kind: "cancel", id });
				notify();
			};
			signal?.addEventListener("abort", cancel, { once: true });
			deliver(deviceId, delivery);
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
			const serving = running ? new Set(running) : null;
			// The calls out with a stream of before. The Device restarted, or
			// that stream died: this one replaces them.
			for (const [id, call] of calls) {
				if (call.deviceId !== deviceId || !call.takenBy) continue;
				if (serving?.has(id)) continue;
				if (!call.answered) {
					// It never reached the Device, or the Device lost it before
					// it began: this stream takes it again.
					redeliver(call);
					continue;
				}
				if (!serving) continue;
				calls.delete(id);
				stopAckTimer(call);
				call.push(
					[
						{
							kind: "error",
							message: "The device of this step stopped before the step ended.",
							offline: true,
						},
					],
					true,
				);
			}
			// A call it still serves that this hub does not know (the Host
			// restarted): nobody waits for it, so it stops there. The
			// Walker's recovery continues the step by its harness session.
			for (const id of serving ?? []) {
				if (!calls.has(id)) box.deliveries.push({ kind: "cancel", id });
			}
			// The newest stream wins: the older ones end.
			for (const older of box.streams) {
				older.end.abort();
				leave(deviceId, older);
			}
			const stream: Stream = { end: new AbortController(), left: false };
			const back = box.streams.size === 0 && !box.lost;
			box.streams.add(stream);
			if (box.lost) {
				clearTimeout(box.lost);
				box.lost = null;
			}
			if (back) options.onBack?.(deviceId);
			const ended = AbortSignal.any([signal, stream.end.signal]);
			let wake: (() => void) | null = null;
			const notify = () => {
				const resolve = wake;
				wake = null;
				resolve?.();
			};
			box.wake.add(notify);
			ended.addEventListener("abort", notify, { once: true });
			try {
				while (!ended.aborted) {
					const delivery = box.deliveries.shift();
					if (delivery) {
						const call =
							delivery.kind === "call" ? calls.get(delivery.id) : undefined;
						if (call) {
							call.takenBy = stream;
							if (box.acks && !call.answered) {
								call.ackTimer = setTimeout(() => {
									call.ackTimer = null;
									if (call.answered || call.takenBy !== stream) return;
									console.warn(
										`[work] device ${deviceId} did not confirm a call: its connection is dead, the call goes again`,
									);
									stream.end.abort();
									leave(deviceId, stream);
									redeliver(call);
								}, ackMs);
								call.ackTimer.unref?.();
							}
						}
						yield delivery;
						continue;
					}
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
				}
			} finally {
				box.wake.delete(notify);
				ended.removeEventListener("abort", notify);
				leave(deviceId, stream);
			}
		},

		reply(deviceId, { id, replies, done }) {
			const call = calls.get(id);
			if (!call || call.deviceId !== deviceId) return false;
			if (replies.length === 0 && !done) inbox(deviceId).acks = true;
			call.answered = true;
			stopAckTimer(call);
			if (done) calls.delete(id);
			call.push(replies, done);
			return true;
		},
	};
}
