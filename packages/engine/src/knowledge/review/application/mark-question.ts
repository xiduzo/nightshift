import { isReadable } from "../../files";
import {
	formatQuestions,
	type KnowledgeQuestion,
	markQuestion as marked,
	parseQuestions,
} from "../domain/questions";
import type { FolderHolds, QuestionSetFile } from "./ports";

export type MarkQuestionPorts = {
	questions: QuestionSetFile;
	holds: FolderHolds;
	now: () => number;
};

/** The question, the files that answer it, and who marks it. */
export type MarkQuestion = {
	projectId: string;
	query: string;
	answers: readonly string[];
	by: string | null;
};

/**
 * Marks the files that answer a question an agent asked, or with no files
 * (or none an agent reads) takes it out of the set. It holds the folder as
 * a step does: the set goes to the Space when the hold ends. Returns the
 * set, newest mark first.
 *
 * It checks no role: the `Knowledge` door has no actor yet (E-doors adds it).
 */
export const markQuestion =
	(ports: MarkQuestionPorts) =>
	async ({
		projectId,
		...mark
	}: MarkQuestion): Promise<KnowledgeQuestion[]> => {
		const hold = await ports.holds.startStep(projectId);
		try {
			const next = marked(
				parseQuestions(await ports.questions.read(projectId)),
				{
					...mark,
					// Only a file an agent reads can answer.
					answers: mark.answers.filter(isReadable),
					at: ports.now(),
				},
			);
			await ports.questions.write(projectId, formatQuestions(next));
			return next;
		} finally {
			await hold.done();
		}
	};
