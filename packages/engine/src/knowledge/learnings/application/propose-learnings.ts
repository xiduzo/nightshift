import {
	formatLearnings,
	PROPOSED_LEARNINGS_DIR,
	proposedLearningFileName,
} from "@nightshift/flows";
import type { LearningStep } from "../domain/waiting";
import type { LearningFolder } from "./ports";

export type ProposeLearningsPorts = {
	folder: Pick<LearningFolder, "has" | "append">;
};

/** The notes, and the step (or the run) that proposes them. */
export type ProposeLearnings = {
	projectId: string;
	step: LearningStep;
	notes: readonly string[];
	/** Who proposes: the agents of a step, or the look back at a run. Default: the agents. */
	by?: "agents" | "run";
};

/**
 * Adds the notes a step or a run proposes to its file in the project's
 * folder, `learnings/proposed/<runId>.<stepId>.md` (or `<runId>.md`). A
 * new file gets its header. No note: nothing is written.
 *
 * The caller holds the folder. It checks no role: the `Knowledge` door has
 * no actor yet (E-doors adds it).
 */
export const proposeLearnings =
	(ports: ProposeLearningsPorts) =>
	async ({
		projectId,
		step,
		notes,
		by = "agents",
	}: ProposeLearnings): Promise<void> => {
		const path = `${PROPOSED_LEARNINGS_DIR}/${proposedLearningFileName(step)}`;
		const isNew = !(await ports.folder.has(projectId, path));
		const text = formatLearnings(notes, { runId: step.runId, isNew, by });
		if (text === "") return;
		await ports.folder.append(projectId, path, text);
	};
