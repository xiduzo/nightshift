import type { RunStatus, StepSummary, TranscriptEntry } from "../runs";

/** Runs `run` after `ms`, and returns a cancel. Tests pass one they run by hand. */
export type Schedule = (run: () => void, ms: number) => () => void;

/** The schedule on the platform's timers. */
export const timerSchedule: Schedule = (run, ms) => {
	const timer = setTimeout(run, ms);
	return () => clearTimeout(timer);
};

/** What came in on the stream of one run during one flush window. */
export type RunStreamBatch = {
	/** New transcript entries, in order. */
	entries: TranscriptEntry[];
	/** New or changed step summaries, in order. */
	steps: StepSummary[];
	/** The latest status, or null when it did not change. */
	status: RunStatus | null;
	/** The seq of the last entry so far: the next follow starts after it. */
	lastSeq: number | null;
};

export type RunStreamBufferOptions = {
	/** How long items gather before one batch. */
	flushMs: number;
	schedule: Schedule;
	/** The seq the stream starts after, when the caller has entries already. */
	lastSeq?: number | null;
	onFlush(batch: RunStreamBatch): void;
};

export type RunStreamBuffer = {
	entry(entry: TranscriptEntry): void;
	step(step: StepSummary): void;
	status(status: RunStatus): void;
	/**
	 * Stops the buffer: nothing more comes out. `flush: true` hands on what
	 * gathered first; else it is dropped.
	 */
	stop(options?: { flush?: boolean }): void;
};

/**
 * Gathers the items of one run's stream, so a fast stream or a long replay
 * renders once per window.
 */
export function createRunStreamBuffer(
	options: RunStreamBufferOptions,
): RunStreamBuffer {
	let entries: TranscriptEntry[] = [];
	let steps: StepSummary[] = [];
	let status: RunStatus | null = null;
	let lastSeq = options.lastSeq ?? null;
	let cancelFlush: (() => void) | null = null;
	let stopped = false;

	function flush() {
		cancelFlush = null;
		const batch = { entries, steps, status, lastSeq };
		entries = [];
		steps = [];
		status = null;
		options.onFlush(batch);
	}
	function scheduleFlush() {
		cancelFlush ??= options.schedule(flush, options.flushMs);
	}

	return {
		entry(entry) {
			if (stopped) return;
			entries.push(entry);
			lastSeq = entry.seq;
			scheduleFlush();
		},
		step(step) {
			if (stopped) return;
			steps.push(step);
			scheduleFlush();
		},
		status(next) {
			if (stopped) return;
			status = next;
			scheduleFlush();
		},
		stop({ flush: handOn = false } = {}) {
			if (stopped) return;
			stopped = true;
			if (!cancelFlush) return;
			cancelFlush();
			if (handOn) flush();
			else cancelFlush = null;
		},
	};
}
