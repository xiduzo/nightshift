import { now as timeNow } from "@nightshift/time";
import {
	type DerivedStep,
	type RunBus,
	type RunLog,
	type TranscriptEntry,
	waker,
} from "../log";
import { deriveSteps } from "./run-views";

/*
 * A run's transcript, as the run page reads it: the entries of all its
 * steps in `seq` order, each once. The steps and the run-wide seq are the
 * engine's. Where each step's entries come from (this computer's files,
 * the archive, a live feed) is the peers' (`RunsPort.stepEntries`).
 */

/** One step, by its Space and run. */
export type FeedStep = { spaceId: string; runId: string; stepId: string };

/** A step's entries after `afterSeq`, then live, until its transcript is whole. */
export type StepEntries = (
	step: FeedStep,
	afterSeq: number,
	signal: AbortSignal,
) => AsyncIterable<TranscriptEntry>;

/** What a run's transcript reads: the steps from the log, each step's entries from the peers. */
export type RunTranscriptPorts = {
	/** The run's steps, derived once per append for every reader (`RunLog.derive`). */
	log: Pick<RunLog, "derive">;
	bus: RunBus;
	stepEntries: StepEntries;
	/** How long an entry waits for a lower seq that another step still owes. Default five seconds. */
	holdMs?: number;
	/** How many ended steps are read at once. Default four. */
	window?: number;
};

const DEFAULT_HOLD_MS = 5_000;
const DEFAULT_WINDOW = 4;

/**
 * A run's transcript after `afterSeq`: the entries of all its steps, in
 * `seq` order, each once, then each new one as it is written, until
 * `signal` aborts. The seq grows by one per entry in the run, so the next
 * entry goes out when it is the one after the last.
 *
 * Every opening of a step is followed once, in the order they opened: an
 * open step at once, an ended one at most `window` at a time. A step's
 * entries can come before a lower seq of another step (the Call step of a
 * For Each and its body steps write in turns). Such an entry waits until
 * the lower seq comes, until no step that is followed could still bring
 * it (a line cut short by a crash), or for `holdMs`. That clock starts once
 * the steps that had ended at the start are read, so a slow archive does
 * not cut the replay short.
 *
 * An entry that comes after its hold ran out is dropped in this read only:
 * a new read shows it. That happens only when the copy of a step walked
 * elsewhere is late by more than `holdMs`. An error of `stepEntries` ends
 * the read with that error.
 */
export async function* followRunTranscript(
	ports: RunTranscriptPorts,
	run: { id: string; spaceId: string },
	afterSeq: number,
	signal: AbortSignal,
): AsyncGenerator<TranscriptEntry> {
	const holdMs = ports.holdMs ?? DEFAULT_HOLD_MS;
	const window = ports.window ?? DEFAULT_WINDOW;
	const stop = new AbortController();
	const abort = () => stop.abort();
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) stop.abort();
	const wakeUp = waker(stop.signal);

	let last = afterSeq;
	/** Entries above `last + 1`, by seq, with the time each came. */
	const held = new Map<number, { entry: TranscriptEntry; came: number }>();
	/** Entries in order, for the caller. */
	const out: TranscriptEntry[] = [];
	/** The error of a step's read: it ends this read. */
	const failures: unknown[] = [];
	/** Openings followed, by step id and opening. */
	const followed = new Set<string>();
	/** Ended steps that wait for a slot of the window. */
	const queued: { step: DerivedStep; initial: boolean }[] = [];
	let reading = 0;
	/** Step streams that have not returned. */
	let streams = 0;
	/** Steps that had ended at the start, not read yet. Null before the first look. */
	let replaying: number | null = null;
	/** When the hold clock started: once the replay is read. */
	let clockFrom = Number.POSITIVE_INFINITY;
	let timer: ReturnType<typeof setTimeout> | null = null;
	/** The steps may have changed: derive them again. */
	let changed = true;
	let deriving = false;

	const emit = (entry: TranscriptEntry) => {
		last = entry.seq;
		out.push(entry);
	};

	/** Sends out the held entries up to `upTo`, in seq order. */
	function release(upTo: number) {
		const seqs = [...held.keys()]
			.filter((s) => s <= upTo)
			.sort((a, b) => a - b);
		for (const seq of seqs) {
			emit((held.get(seq) as { entry: TranscriptEntry }).entry);
			held.delete(seq);
		}
	}

	function flush() {
		for (let next = held.get(last + 1); next; next = held.get(last + 1)) {
			held.delete(last + 1);
			emit(next.entry);
		}
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		if (held.size === 0) return;
		// Nothing still followed can bring the missing seq: a cut line.
		if (streams === 0 && queued.length === 0 && !changed && !deriving) {
			release(Number.POSITIVE_INFINITY);
			return;
		}
		if (clockFrom === Number.POSITIVE_INFINITY) return;
		const now = timeNow();
		let due = Number.POSITIVE_INFINITY;
		let upTo = Number.NEGATIVE_INFINITY;
		for (const [seq, { came }] of held) {
			const at = Math.max(came, clockFrom) + holdMs;
			if (at <= now) upTo = Math.max(upTo, seq);
			else due = Math.min(due, at);
		}
		if (upTo > Number.NEGATIVE_INFINITY) {
			release(upTo);
			flush();
			return;
		}
		timer = setTimeout(() => {
			timer = null;
			flush();
			wakeUp.notify();
		}, due - now);
	}

	function take(entry: TranscriptEntry) {
		if (entry.seq <= last || held.has(entry.seq)) return;
		held.set(entry.seq, { entry, came: timeNow() });
		flush();
		wakeUp.notify();
	}

	function replayed() {
		if (replaying === null || replaying > 0) return;
		replaying = 0;
		clockFrom = timeNow();
	}

	function follow(step: DerivedStep, ended: boolean, initial: boolean) {
		streams++;
		if (ended) reading++;
		const at = { spaceId: run.spaceId, runId: run.id, stepId: step.id };
		const from = last;
		void (async () => {
			try {
				for await (const entry of ports.stepEntries(at, from, stop.signal)) {
					take(entry);
				}
			} catch (error) {
				if (!stop.signal.aborted) failures.push(error);
			} finally {
				streams--;
				if (ended) reading--;
				if (initial && replaying !== null) {
					replaying--;
					replayed();
				}
				next();
				flush();
				wakeUp.notify();
			}
		})();
	}

	/** Starts the ended steps that wait, while the window has room. */
	function next() {
		while (reading < window && queued.length > 0 && !stop.signal.aborted) {
			const { step, initial } = queued.shift() as (typeof queued)[number];
			follow(step, true, initial);
		}
	}

	async function derive() {
		deriving = true;
		try {
			const first = replaying === null;
			let initial = 0;
			const derived = await ports.log.derive([run.id], deriveSteps);
			const steps = (derived.get(run.id) ?? []).toSorted(
				(a, b) => a.openedSeq - b.openedSeq,
			);
			for (const step of steps) {
				const key = `${step.id}:${step.openedSeq}`;
				if (followed.has(key)) continue;
				followed.add(key);
				if (step.endedAt === null) {
					follow(step, false, false);
				} else {
					queued.push({ step, initial: first });
					if (first) initial++;
				}
			}
			if (first) replaying = initial;
			next();
		} finally {
			deriving = false;
		}
		replayed();
		flush();
	}

	// Subscribe before the first look at the log: no step is missed.
	const off = ports.bus.subscribe(run.id, (item) => {
		if (item.kind === "transcript") return;
		changed = true;
		wakeUp.notify();
	});
	try {
		while (!stop.signal.aborted) {
			if (failures.length > 0) throw failures[0];
			const entry = out.shift();
			if (entry) {
				yield entry;
				continue;
			}
			if (changed) {
				changed = false;
				await derive();
				continue;
			}
			await wakeUp.wait();
		}
	} finally {
		off();
		stop.abort();
		if (timer) clearTimeout(timer);
		wakeUp.close();
		signal.removeEventListener("abort", abort);
	}
}
