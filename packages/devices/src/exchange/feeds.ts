import {
	type FeedStep,
	followOwnStep,
	HostUnreachableError,
	RUN_NOT_FOUND,
	type RunBus,
	type TranscriptEntry,
} from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import type { FollowWant } from "../contract";
import { pause } from "../links";

/**
 * Live transcripts: one feed per step, the same on every Replica.
 * `entries(step, afterSeq)` is a viewer's transcript of a step (the
 * engine's `RunsPort.stepEntries`): the archive's copy of a step that
 * ended, else the step's feed, tried again until the step's transcript is
 * whole. `follow(step, afterSeq)` is that feed, and what a Host serves:
 * it yields the step's transcript entries after `afterSeq`, first what
 * was written, then each entry as it is written, and ends when the step
 * ends. Where the entries come from depends on who walks the run:
 *
 * - This Replica walks it: its own file, then its bus.
 * - This Replica keeps the Space (it is the Host) and a Device walks it:
 *   the Host's tail of the step. The tail asks the Walker for the step
 *   while it has followers (`wanted`, carried to the Walker on its sync
 *   stream), and the Walker's pumps fill it (`deliver`). No followers:
 *   the Walker stops sending.
 * - A Host keeps the Space: that Host's feed, over the link (`upstream`).
 *
 * The cursor is the entry's `seq`, which grows by one per entry in the
 * run. Every receiver drops an entry at or below the last `seq` it has, so
 * a resend is harmless and a reconnect from a cursor has no duplicates
 * and no gaps. Live entries are a cache: the archive's copy, put when the
 * step ends, stays the truth. A Host keeps a tail in memory only, from the
 * step's first entry, for `idleMs` after its last follower left.
 *
 * Who may follow is the daemon's check (membership, the Walker of a
 * push), as for the archive.
 */

export type FeedPorts = {
	bus: RunBus;
	/** This Replica's Walker id. */
	selfId(): Promise<string>;
	/** A run's Walker and Space, or null for a run this Replica lacks. */
	runOwner(
		runId: string,
	): Promise<{ walkerId: string; spaceId: string } | null>;
	/** The Host that keeps the Space, or null when this Replica keeps it. */
	hostOf(spaceId: string): Promise<string | null>;
	/** Whether the step has ended, as this Replica's log says. */
	stepEnded(step: FeedStep): Promise<boolean>;
	/** The transcript of a step this Replica walked, from its own file. */
	ownEntries(step: FeedStep): Promise<TranscriptEntry[]>;
	/**
	 * The archive copy of a step that ended: this Replica's, else the
	 * Host's that keeps the Space, kept here once fetched. Null when
	 * neither has a copy of the end this Replica knows of (its stamp): the
	 * feed reads the step instead. Asked only for a step that ended.
	 */
	archived(step: FeedStep): Promise<TranscriptEntry[] | null>;
	/** The feed of the Host that keeps the Space. */
	upstream?(
		step: FeedStep,
		afterSeq: number,
		signal: AbortSignal,
	): AsyncIterable<TranscriptEntry>;
	/** How long a Host keeps a tail nobody follows. Default five minutes. */
	idleMs?: number;
	/**
	 * How long a pump waits before it sends a batch again, and a viewer
	 * before it follows a step again. Default two seconds.
	 */
	retryMs?: number;
	/**
	 * How long the feed of a step that ended may stay silent before a
	 * viewer looks in the archive again (a Walker of an older version, a
	 * Host away). Default five seconds.
	 */
	graceMs?: number;
};

/** The Walker's side: the steps its Host wants, each sent by a pump. */
export type FollowPumps = {
	/** The steps the Host wants now: new ones start, missing ones stop. */
	set(wants: readonly FollowWant[]): void;
	/** Stops every pump (the stream to the Host ended). */
	close(): void;
};

/** Sends entries of a step to the Host; `ended`: the step ended, these are the last. */
export type FeedSend = (
	step: FeedStep,
	entries: TranscriptEntry[],
	ended: boolean,
	signal: AbortSignal,
) => Promise<void>;

export type TranscriptFeeds = {
	/**
	 * A viewer's transcript of a step (the engine's `RunsPort.stepEntries`):
	 * a run walked here from its own file, then live. Else an ended step
	 * from the archive (`archived`), and a running one from its feed
	 * (`follow`). A feed that fails, or that stays silent for `graceMs`
	 * after the step ended, is tried again after `retryMs`, from the last
	 * entry it yielded. It returns when the transcript is whole, or when
	 * `signal` aborts. It throws only for a run this Replica lacks.
	 */
	entries(
		step: FeedStep,
		afterSeq: number,
		signal: AbortSignal,
	): AsyncIterable<TranscriptEntry>;
	/**
	 * The step's feed: its entries after `afterSeq`, then live, until it
	 * ends or `signal` aborts. What a Host serves, and what `entries`
	 * reads a running step from. It does not try again: it throws when
	 * the Host is away.
	 */
	follow(
		step: FeedStep,
		afterSeq: number,
		signal: AbortSignal,
	): AsyncIterable<TranscriptEntry>;
	/** Host: the steps a Walker should send now, from the cursor it should send from. */
	wanted(walkerId: string): FollowWant[];
	/** Host: tells `listener` when that set may have changed. Returns how to stop. */
	onWanted(walkerId: string, listener: () => void): () => void;
	/** Host: entries a Walker sent for a step it walks. Others are dropped. */
	deliver(
		walkerId: string,
		step: FeedStep,
		entries: readonly TranscriptEntry[],
		ended: boolean,
	): void;
	/** Walker: pumps that send the steps a Host wants through `send`. */
	pumps(send: FeedSend): FollowPumps;
};

/** A Host's copy of a followed step. */
type Tail = {
	walkerId: string;
	step: FeedStep;
	/** In `seq` order, from the step's first entry. */
	entries: TranscriptEntry[];
	last: number;
	ended: boolean;
	followers: number;
	wake: Set<() => void>;
	idle: ReturnType<typeof setTimeout> | null;
};

const DEFAULT_IDLE_MS = 5 * 60_000;
const DEFAULT_GRACE_MS = 5_000;
const BATCH = 500;

export function createTranscriptFeeds(ports: FeedPorts): TranscriptFeeds {
	const idleMs = ports.idleMs ?? DEFAULT_IDLE_MS;
	const retryMs = ports.retryMs ?? 2_000;
	const graceMs = ports.graceMs ?? DEFAULT_GRACE_MS;
	const tails = new Map<string, Tail>();
	const listeners = new Map<string, Set<() => void>>();

	function changed(walkerId: string) {
		for (const listener of [...(listeners.get(walkerId) ?? [])]) {
			try {
				listener();
			} catch {
				// A broken listener must not break the others.
			}
		}
	}

	/** The step's own feed: its file, then its bus, until it ends. */
	const own = (step: FeedStep, afterSeq: number, signal: AbortSignal) =>
		followOwnStep(ports, step, afterSeq, signal);

	function openTail(step: FeedStep, walkerId: string): Tail {
		let tail = tails.get(step.stepId);
		if (
			tail &&
			(tail.walkerId !== walkerId || tail.step.runId !== step.runId)
		) {
			// The run moved to another Walker: start again.
			if (tail.idle) clearTimeout(tail.idle);
			tails.delete(step.stepId);
			tail = undefined;
		}
		if (!tail) {
			tail = {
				walkerId,
				step: { spaceId: step.spaceId, runId: step.runId, stepId: step.stepId },
				entries: [],
				last: 0,
				ended: false,
				followers: 0,
				wake: new Set(),
				idle: null,
			};
			tails.set(step.stepId, tail);
		}
		if (tail.idle) {
			clearTimeout(tail.idle);
			tail.idle = null;
		}
		tail.followers++;
		if (tail.followers === 1 && !tail.ended) changed(walkerId);
		return tail;
	}

	function closeTail(tail: Tail) {
		tail.followers--;
		if (tail.followers > 0) return;
		if (tail.ended) {
			if (tails.get(tail.step.stepId) === tail) tails.delete(tail.step.stepId);
			return;
		}
		// Nobody follows: the Walker stops sending. The tail stays a while,
		// so a viewer that comes back resumes from it.
		changed(tail.walkerId);
		tail.idle = setTimeout(() => {
			if (tails.get(tail.step.stepId) === tail && tail.followers === 0) {
				tails.delete(tail.step.stepId);
			}
		}, idleMs);
		tail.idle.unref?.();
	}

	/** A step another Device walks, in a Space this Replica keeps. */
	async function* relayed(
		step: FeedStep,
		walkerId: string,
		afterSeq: number,
		signal: AbortSignal,
	): AsyncGenerator<TranscriptEntry> {
		if (!tails.has(step.stepId) && (await ports.stepEnded(step))) {
			const archived = await ports.archived(step);
			if (archived) {
				for (const entry of archived) if (entry.seq > afterSeq) yield entry;
				return;
			}
			// Ended, but its archive copy is on its way: the Walker sends it.
		}
		const tail = openTail(step, walkerId);
		const wakeUp = waker(signal);
		tail.wake.add(wakeUp.notify);
		try {
			let at = afterSeq;
			let index = 0;
			while (!signal.aborted) {
				if (index < tail.entries.length) {
					const entry = tail.entries[index++] as TranscriptEntry;
					if (entry.seq <= at) continue;
					at = entry.seq;
					yield entry;
					continue;
				}
				if (tail.ended) return;
				await wakeUp.wait();
			}
		} finally {
			tail.wake.delete(wakeUp.notify);
			wakeUp.close();
			closeTail(tail);
		}
	}

	async function* follow(
		step: FeedStep,
		afterSeq: number,
		signal: AbortSignal,
	): AsyncGenerator<TranscriptEntry> {
		const owner = await ports.runOwner(step.runId);
		if (!owner || owner.spaceId !== step.spaceId) {
			throw new Refusal("not-found", RUN_NOT_FOUND);
		}
		if (owner.walkerId === (await ports.selfId())) {
			yield* own(step, afterSeq, signal);
			return;
		}
		if ((await ports.hostOf(step.spaceId)) === null) {
			yield* relayed(step, owner.walkerId, afterSeq, signal);
			return;
		}
		if (!ports.upstream) {
			throw new HostUnreachableError();
		}
		let at = afterSeq;
		for await (const entry of ports.upstream(step, afterSeq, signal)) {
			if (entry.stepId !== step.stepId || entry.seq <= at) continue;
			at = entry.seq;
			yield entry;
		}
	}

	async function* entries(
		step: FeedStep,
		afterSeq: number,
		signal: AbortSignal,
	): AsyncGenerator<TranscriptEntry> {
		const owner = await ports.runOwner(step.runId);
		if (!owner || owner.spaceId !== step.spaceId) {
			throw new Refusal("not-found", RUN_NOT_FOUND);
		}
		if (owner.walkerId === (await ports.selfId())) {
			yield* own(step, afterSeq, signal);
			return;
		}
		let at = afterSeq;
		while (!signal.aborted) {
			const ended = await ports.stepEnded(step);
			if (ended) {
				const copy = await ports.archived(step).catch(() => null);
				if (copy) {
					for (const entry of copy) {
						if (signal.aborted) return;
						if (entry.seq <= at) continue;
						at = entry.seq;
						yield entry;
					}
					return;
				}
			}
			// The step runs, or its copy has not landed yet: its feed.
			const feed = new AbortController();
			const stop = () => feed.abort();
			signal.addEventListener("abort", stop, { once: true });
			let grace: ReturnType<typeof setTimeout> | null = null;
			const silent = () => {
				if (grace) clearTimeout(grace);
				grace = setTimeout(stop, graceMs);
			};
			if (ended) silent();
			const off = ports.bus.subscribe(step.runId, (item) => {
				if (grace || item.kind === "transcript") return;
				void ports
					.stepEnded(step)
					.then((now) => {
						if (now && !grace) silent();
					})
					.catch(() => {});
			});
			let whole = false;
			try {
				for await (const entry of follow(step, at, feed.signal)) {
					if (entry.seq <= at) continue;
					at = entry.seq;
					if (grace) silent();
					yield entry;
				}
				whole = !feed.signal.aborted;
			} catch {
				// The Host is away, or does not know the feed: try again.
			} finally {
				off();
				if (grace) clearTimeout(grace);
				signal.removeEventListener("abort", stop);
			}
			if (whole) return;
			await pause(retryMs, signal);
		}
	}

	function pumps(send: FeedSend): FollowPumps {
		const running = new Map<string, AbortController>();
		/** Steps whose end the Host has, until they leave its set. */
		const finished = new Set<string>();

		/** Sends one step from the cursor. True when it sent the step's end. */
		async function pump(want: FollowWant, signal: AbortSignal) {
			const step: FeedStep = {
				spaceId: want.spaceId,
				runId: want.runId,
				stepId: want.stepId,
			};
			const owner = await ports.runOwner(step.runId);
			// Only a step of a run this Replica walks: never a loop to a Host.
			if (
				!owner ||
				owner.spaceId !== step.spaceId ||
				owner.walkerId !== (await ports.selfId())
			) {
				return false;
			}
			const buffer: TranscriptEntry[] = [];
			let done = false;
			let failed = false;
			const wakeUp = waker(signal);
			const reader = (async () => {
				try {
					for await (const entry of own(step, want.afterSeq, signal)) {
						buffer.push(entry);
						wakeUp.notify();
					}
					done = !signal.aborted;
				} catch {
					failed = true;
				} finally {
					wakeUp.notify();
				}
			})();
			try {
				while (!signal.aborted && !failed) {
					if (buffer.length === 0 && !done) {
						await wakeUp.wait();
						continue;
					}
					const batch = buffer.splice(0, BATCH);
					const ended = done && buffer.length === 0;
					if (!(await sendUntilTaken(step, batch, ended, signal))) break;
					if (ended) return true;
				}
				return false;
			} finally {
				wakeUp.close();
				await reader;
			}
		}

		/** Sends a batch again until the Host takes it, or the pump stops. */
		async function sendUntilTaken(
			step: FeedStep,
			batch: TranscriptEntry[],
			ended: boolean,
			signal: AbortSignal,
		): Promise<boolean> {
			while (!signal.aborted) {
				try {
					await send(step, batch, ended, signal);
					return true;
				} catch {
					await pause(retryMs, signal);
				}
			}
			return false;
		}

		return {
			set(wants) {
				const ids = new Set(wants.map((w) => w.stepId));
				for (const [stepId, controller] of running) {
					if (ids.has(stepId)) continue;
					controller.abort();
					running.delete(stepId);
				}
				for (const stepId of finished) {
					if (!ids.has(stepId)) finished.delete(stepId);
				}
				for (const want of wants) {
					if (running.has(want.stepId) || finished.has(want.stepId)) continue;
					const controller = new AbortController();
					running.set(want.stepId, controller);
					void pump(want, controller.signal)
						.catch(() => false)
						.then((ended) => {
							if (running.get(want.stepId) !== controller) return;
							running.delete(want.stepId);
							if (ended) finished.add(want.stepId);
						});
				}
			},
			close() {
				for (const controller of running.values()) controller.abort();
				running.clear();
				finished.clear();
			},
		};
	}

	return {
		entries,
		follow,
		wanted(walkerId) {
			const wants: FollowWant[] = [];
			for (const tail of tails.values()) {
				if (tail.walkerId !== walkerId || tail.followers === 0 || tail.ended) {
					continue;
				}
				wants.push({ ...tail.step, afterSeq: tail.last });
			}
			return wants;
		},
		onWanted(walkerId, listener) {
			let set = listeners.get(walkerId);
			if (!set) {
				set = new Set();
				listeners.set(walkerId, set);
			}
			set.add(listener);
			return () => {
				const current = listeners.get(walkerId);
				current?.delete(listener);
				if (current?.size === 0) listeners.delete(walkerId);
			};
		},
		deliver(walkerId, step, entries, ended) {
			const tail = tails.get(step.stepId);
			if (
				!tail ||
				tail.walkerId !== walkerId ||
				tail.step.runId !== step.runId ||
				tail.step.spaceId !== step.spaceId ||
				tail.ended
			) {
				return;
			}
			for (const entry of entries) {
				if (entry.stepId !== step.stepId || entry.seq <= tail.last) continue;
				tail.entries.push(entry);
				tail.last = entry.seq;
			}
			if (ended) {
				tail.ended = true;
				if (tail.followers === 0) {
					if (tail.idle) clearTimeout(tail.idle);
					tails.delete(step.stepId);
				} else {
					changed(walkerId);
				}
			}
			for (const wake of [...tail.wake]) wake();
		},
		pumps,
	};
}

/**
 * Wakes one waiting loop. A notify before the wait is not lost: the next
 * wait returns at once. Aborting the signal wakes it too.
 */
function waker(signal: AbortSignal) {
	let pending = false;
	let resolve: (() => void) | null = null;
	const notify = () => {
		pending = true;
		const wake = resolve;
		resolve = null;
		wake?.();
	};
	signal.addEventListener("abort", notify, { once: true });
	return {
		notify,
		wait(): Promise<void> {
			if (pending || signal.aborted) {
				pending = false;
				return Promise.resolve();
			}
			return new Promise<void>((r) => {
				resolve = () => {
					pending = false;
					r();
				};
			});
		},
		close() {
			signal.removeEventListener("abort", notify);
		},
	};
}
