import {
	ASKED_LIMIT,
	ASKED_WINDOW,
	type AskedQuestion,
	askedQuestionsOf,
} from "../domain/use";
import type { KnowledgeUseLog } from "./ports";

export type ListAskedQuestionsPorts = {
	log: KnowledgeUseLog;
};

/** Which project's questions, and at most how many (default 50). */
export type ListAskedQuestions = { projectId: string; limit?: number };

/**
 * The questions agents asked a project's knowledge, newest first, at most
 * `limit`: each question once, with what its last asking found. From its
 * latest 2 000 searches, in runs and through the MCP server.
 *
 * It checks no role: the `Knowledge` door has no actor yet (E-doors adds it).
 */
export const listAskedQuestions =
	(ports: ListAskedQuestionsPorts) =>
	async ({ projectId, limit }: ListAskedQuestions): Promise<AskedQuestion[]> =>
		askedQuestionsOf(
			await ports.log.events(projectId, ["KnowledgeSearched"], {
				limit: ASKED_WINDOW,
			}),
			limit ?? ASKED_LIMIT,
		);
