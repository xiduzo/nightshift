import type { KnowledgeReconciler } from "../../sync";
import { type KnowledgeQuestion, parseQuestions } from "../domain/questions";
import type { QuestionSetFile } from "./ports";

export type ReadQuestionSetPorts = {
	questions: Pick<QuestionSetFile, "read">;
	holds: Pick<KnowledgeReconciler, "startStep">;
};

/** Which project's question set. */
export type ReadQuestionSet = { projectId: string };

/**
 * The question set as the Space has it: it holds the folder as a step
 * does, so the folder is brought in step first. A file that is not there,
 * or not valid, gives an empty set.
 *
 * It checks no role: the `Knowledge` door has no actor yet (E-doors adds it).
 */
export const readQuestionSet =
	(ports: ReadQuestionSetPorts) =>
	async ({ projectId }: ReadQuestionSet): Promise<KnowledgeQuestion[]> => {
		const hold = await ports.holds.startStep(projectId);
		try {
			return parseQuestions(await ports.questions.read(projectId));
		} finally {
			await hold.done();
		}
	};
