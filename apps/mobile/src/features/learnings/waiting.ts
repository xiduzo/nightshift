import type { ApiOutputs } from "@nightshift/client";

/** One step's learnings that wait for a person, with its project. */
export type Learning = ApiOutputs["knowledge"]["learnings"][number];

/** A learning's key over every project: its id is only one in its project. */
export function learningKey(learning: {
	projectId: string;
	id: string;
}): string {
	return `${learning.projectId}:${learning.id}`;
}

/**
 * The learnings that still wait as you see them: without the ones you
 * keep or delete now, or kept or deleted before the list reads again.
 */
export function stillWaiting(
	learnings: readonly Learning[],
	settled: ReadonlySet<string>,
): Learning[] {
	if (settled.size === 0) return [...learnings];
	return learnings.filter((learning) => !settled.has(learningKey(learning)));
}

/** "1 learning waits for you", "3 learnings wait for you". */
export function waitingText(count: number): string {
	return count === 1
		? "1 learning waits for you"
		: `${count} learnings wait for you`;
}
