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
 * Keep waits for notes you can read: a person does not keep what they cannot
 * see. Delete does not.
 */
export function canKeep(learning: { notes: readonly string[] }): boolean {
	return learning.notes.length > 0;
}

/** What a person whose role does not let them decide can do. */
export const ASK_A_MEMBER = "Ask a Member of this Space to review it.";
