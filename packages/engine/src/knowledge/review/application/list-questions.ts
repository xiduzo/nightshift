import { type KnowledgeQuestion, questionKey } from "../domain/questions";
import type { AskedQuestion } from "../domain/use";
import type { listAskedQuestions } from "./list-asked-questions";
import type { QuestionSet } from "./ports";

export type ListQuestionsPorts = {
	/** `listAskedQuestions`, bound by the wire. */
	asked: ReturnType<typeof listAskedQuestions>;
	questionSet: QuestionSet;
};

/** Which project's questions, and at most how many asked ones (default 50). */
export type ListQuestions = { projectId: string; limit?: number };

/** A question agents asked, and the files a person marked as its answer. */
type AskedQuestionWithAnswers = AskedQuestion & {
	/** Null: it is not in the question set. */
	answers: string[] | null;
};

/** The questions agents asked a project's knowledge, and its question set. */
export type KnowledgeQuestions = {
	asked: AskedQuestionWithAnswers[];
	set: KnowledgeQuestion[];
};

/**
 * The questions agents asked, newest first (at most `limit`), with the
 * files a person marked as the answer, and the question set as the Space
 * has it. Both reads start at once.
 *
 * It checks no role: the `Knowledge` door has no actor yet (E-doors adds it).
 */
export const listQuestions =
	(ports: ListQuestionsPorts) =>
	async ({ projectId, limit }: ListQuestions): Promise<KnowledgeQuestions> => {
		const [asked, set] = await Promise.all([
			ports.asked({ projectId, ...(limit !== undefined ? { limit } : {}) }),
			ports.questionSet.questionSet(projectId),
		]);
		const answers = new Map(
			set.map((question) => [questionKey(question.query), question.answers]),
		);
		return {
			asked: asked.map((question) => ({
				...question,
				answers: answers.get(questionKey(question.query)) ?? null,
			})),
			set,
		};
	};
