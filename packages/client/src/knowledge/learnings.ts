import type { ApiOutputs } from "../api";

/** One step's learnings that wait for a person, with its project. */
export type WaitingLearning = ApiOutputs["knowledge"]["learnings"][number];

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
export function stillWaiting<T extends { projectId: string; id: string }>(
	learnings: readonly T[],
	settled: ReadonlySet<string>,
): T[] {
	if (settled.size === 0) return [...learnings];
	return learnings.filter((learning) => !settled.has(learningKey(learning)));
}

/**
 * Keep waits for notes you can read: a person does not keep what they cannot
 * see. Delete does not.
 */
export function canKeep(learning: { notes: readonly string[] }): boolean {
	return learning.notes.length > 0;
}

/**
 * Whether the person's role lets them keep or delete it. A Host of an older
 * version does not say: the server decides at the tap, as it always does.
 */
export function mayDecide(learning: { mayDecide?: boolean }): boolean {
	return learning.mayDecide !== false;
}

/** What a person whose role does not let them decide can do. */
export const ASK_A_MEMBER = "Ask a Member of this Space to review it.";
