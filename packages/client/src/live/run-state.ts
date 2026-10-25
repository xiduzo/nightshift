import type {
	RunStatus,
	RunStreamConnection,
	StepSummary,
	TranscriptEntry,
} from "../runs";
import type { RunStreamBatch } from "./run-buffer";

/**
 * How a screen keeps the transcript entries of a run: the web app groups
 * them by step, the phone keeps the latest agent message of each step, the
 * transcript sheet keeps the newest ones.
 */
export type EntryFold<T> = {
	/** What the screen keeps before the first entry. */
	empty(): T;
	/** Adds new entries, in order. */
	add(kept: T, entries: TranscriptEntry[]): T;
};

/** What a screen keeps of one run's stream. */
export type LiveRunState<T> = {
	/** The steps from the stream, by id. Lay them over the fetched run with `mergeSteps`. */
	steps: ReadonlyMap<string, StepSummary>;
	/** The run's status from the stream, before the run is read again. Null until one came. */
	status: RunStatus | null;
	/** The entries, kept the screen's way. */
	entries: T;
};

/** One run, live: what came on its stream, and the state of the stream. */
export type LiveRun<T> = LiveRunState<T> & { connection: RunStreamConnection };

/** Nothing came yet. */
export function emptyLiveRun<T>(fold: EntryFold<T>): LiveRunState<T> {
	return { steps: new Map(), status: null, entries: fold.empty() };
}

/**
 * Lays one batch of a run's stream over what the screen keeps: a step
 * replaces the step of its id, a status the status, and the entries go
 * to the screen's fold. A part with nothing new stays the same object.
 */
export function applyRunBatch<T>(
	state: LiveRunState<T>,
	batch: RunStreamBatch,
	fold: EntryFold<T>,
): LiveRunState<T> {
	let steps = state.steps;
	if (batch.steps.length > 0) {
		const next = new Map(state.steps);
		for (const step of batch.steps) next.set(step.id, step);
		steps = next;
	}
	return {
		steps,
		status: batch.status ?? state.status,
		entries:
			batch.entries.length > 0
				? fold.add(state.entries, batch.entries)
				: state.entries,
	};
}
