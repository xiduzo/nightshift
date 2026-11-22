import type { LearningRun, LearningSignal } from "./signals";

/**
 * The rules of the look back at a run that ended (ADR 37): which run came
 * before it, how much of the runs it reads, and the queue that makes it
 * look at one run at a time.
 */

/** The run's facts as the look back reads them, with what finds the run before. */
export type EndedRun = LearningRun & {
	projectId: string;
	createdAt: number;
	endedAt: number | null;
};

/** A run of the project, as the list of its recent runs gives it. */
export type RecentRun = {
	id: string;
	flowName: string | null;
	createdAt: number;
	endedAt: number | null;
};

/** What one look at a run found. */
export type RunLookBack = {
	signals: LearningSignal[];
	/** The notes proposed. Empty: none, or the run was not looked at. */
	notes: string[];
};

/** Runs of the project the search for the run before reads, newest first. */
export const RECENT_RUNS = 50;
/** Lines of each transcript the evidence shows at most. */
export const TRANSCRIPT_LINES = 60;
/** How long one look may take, unless told otherwise: 5 minutes. */
export const LOOK_TIMEOUT_MS = 5 * 60_000;

/** A look that found nothing to look at. */
export const NOTHING: RunLookBack = { signals: [], notes: [] };

/**
 * The run of the same flow that ended before `run`, among the recent runs
 * of its project. Null: a quick run, or none ended before it.
 */
export function runBefore(
	run: Pick<EndedRun, "id" | "flowName" | "createdAt">,
	recent: readonly RecentRun[],
): RecentRun | null {
	if (run.flowName === null) return null;
	return (
		recent
			.filter(
				(each) =>
					each.id !== run.id &&
					each.flowName === run.flowName &&
					each.endedAt !== null &&
					each.createdAt < run.createdAt,
			)
			.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
	);
}

/** The looks of one look back, one at a time. */
export type LookQueue = {
	/** Runs `look` after every look before it. Its failure stops no later look. */
	add<T>(look: () => Promise<T>): Promise<T>;
	/** Resolves when every look in the queue is done. */
	idle(): Promise<void>;
};

export function createLookQueue(): LookQueue {
	let queue: Promise<unknown> = Promise.resolve();
	return {
		add(look) {
			const next = queue.then(look);
			queue = next.catch(() => {});
			return next;
		},
		async idle() {
			// A look that queues while this waits is waited for too.
			let last: Promise<unknown>;
			do {
				last = queue;
				await last;
			} while (last !== queue);
		},
	};
}
