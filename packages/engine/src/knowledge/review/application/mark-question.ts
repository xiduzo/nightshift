import type { Permissions } from "@nightshift/auth";
import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import { isReadable } from "../../files";
import type { KnowledgeReconciler } from "../../sync";
import {
	formatQuestions,
	type KnowledgeQuestion,
	markQuestion as marked,
	parseQuestions,
} from "../domain/questions";
import type { QuestionSetFile } from "./ports";

const CHANGES_KNOWLEDGE: Permissions = { run: ["start"] };

export type MarkQuestionPorts = {
	access: Pick<Access, "openSpace">;
	questions: QuestionSetFile;
	holds: Pick<KnowledgeReconciler, "startStep">;
	now: () => number;
};

/** The question, the files that answer it, and who marks it. */
export type MarkQuestion = {
	spaceId: string;
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
 * Refuses a Person who may not change knowledge (`access.openSpace`).
 */
export const markQuestion =
	(ports: MarkQuestionPorts) =>
	async (
		actor: Actor,
		{ spaceId, projectId, ...mark }: MarkQuestion,
	): Promise<KnowledgeQuestion[]> => {
		await ports.access.openSpace(actor, { spaceId, need: CHANGES_KNOWLEDGE });
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
