import type { LearningEntries } from "./ports";

export type SetLearnsFromRunsPorts = {
	documents: Pick<LearningEntries, "open">;
};

/** The project, and whether Night Shift learns from its runs. */
export type SetLearnsFromRuns = { projectId: string; on: boolean };

/**
 * Turns the learnings from runs on or off for the project, for every
 * Device of its Space.
 *
 * It checks no role: the `Knowledge` door has no actor yet (E-doors adds it).
 */
export const setLearnsFromRuns =
	(ports: SetLearnsFromRunsPorts) =>
	async ({ projectId, on }: SetLearnsFromRuns): Promise<void> => {
		await (await ports.documents.open(projectId)).setLearnsFromRuns(on);
	};
