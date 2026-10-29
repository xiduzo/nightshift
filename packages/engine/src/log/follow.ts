import type { BusItem } from "./bus";
import type { TranscriptEntry } from "./step-events";

/** One step, by its Space and run. */
type Step = { spaceId: string; runId: string; stepId: string };

/** What the live transcript of a step this Replica walks reads. */
export type OwnFeedPorts = {
	/** Calls back with each change of the run as it happens here (`RunHistory.watch`). */
	watch(runId: string, listener: (item: BusItem) => void): () => void;
	/** Whether the step has ended, as this Replica's log says. */
	stepEnded(step: Step): Promise<boolean>;
	/** The transcript of a step this Replica walked, from its own file. */
	ownEntries(step: Step): Promise<TranscriptEntry[]>;
	/** This Replica's archive copy of a step's transcript, or null. */
	archived(step: Step): Promise<TranscriptEntry[] | null>;
};

/**
 * The live transcript of a step this Replica walks: its entries after
 * `afterSeq` from its file, then each new one as it is written, until the
 * step ends or the signal aborts. The cursor is the entry's `seq`.
 */
export async function* followOwnStep(
	ports: OwnFeedPorts,
	step: Step,
	afterSeq: number,
	signal: AbortSignal,
): AsyncGenerator<TranscriptEntry> {
	const queue: TranscriptEntry[] = [];
	let check = false;
	const wakeUp = waker(signal);
	// Subscribe before reading: an entry is on disk before it is
	// published, so every entry is on disk or queued.
	const off = ports.watch(step.runId, (item) => {
		if (item.kind === "transcript") {
			if (item.entry.stepId !== step.stepId) return;
			queue.push(item.entry);
		} else {
			check = true;
		}
		wakeUp.notify();
	});
	try {
		let at = afterSeq;
		let ended = await ports.stepEnded(step);
		let entries = await ports.ownEntries(step);
		// A step walked elsewhere before the run moved here: the archive has it.
		if (ended && entries.length === 0) {
			entries = (await ports.archived(step)) ?? [];
		}
		for (const entry of entries) {
			if (signal.aborted) return;
			if (entry.seq <= at) continue;
			at = entry.seq;
			yield entry;
		}
		while (!signal.aborted) {
			const entry = queue.shift();
			if (entry) {
				if (entry.seq <= at) continue;
				at = entry.seq;
				yield entry;
				continue;
			}
			// Every entry of an ended step was queued before its end.
			if (ended) return;
			if (check) {
				check = false;
				ended = await ports.stepEnded(step);
				continue;
			}
			await wakeUp.wait();
		}
	} finally {
		off();
		wakeUp.close();
	}
}

/**
 * Wakes one waiting loop. A notify before the wait is not lost: the next
 * wait returns at once. Aborting the signal wakes it too.
 */
export function waker(signal: AbortSignal) {
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
