import type { Database } from "@nightshift/db";
import { now as timeNow } from "@nightshift/time";
import { drizzleKnowledgeUseLog } from "./adapters/out/drizzle-knowledge-use-log";
import { listAskedQuestions } from "./application/list-asked-questions";
import { readKnowledgeUse } from "./application/read-knowledge-use";
import type { AskedQuestion, KnowledgeUseReport } from "./domain/use";

/**
 * The reads of the event log, bound over the real log as `wireReview`
 * binds them, with the arguments of the old functions: for the tests that
 * moved with them.
 */

/** The questions agents asked a project's knowledge, newest first, at most `limit` (`listAskedQuestions`). */
export function askedQuestions(
	db: Database,
	projectId: string,
	options: { limit?: number } = {},
): Promise<AskedQuestion[]> {
	return listAskedQuestions({ log: drizzleKnowledgeUseLog(db) })({
		projectId,
		...(options.limit !== undefined ? { limit: options.limit } : {}),
	});
}

/** How agents used each file of a project's knowledge at `now`, and which `listed` ones are not used (`readKnowledgeUse`). */
export async function knowledgeFileUse(
	db: Database,
	projectId: string,
	listed: readonly { path: string; changedAt: number }[],
	now: number = timeNow(),
): Promise<KnowledgeUseReport> {
	const read = readKnowledgeUse({
		files: { files: async () => listed.map((file) => ({ size: 0, ...file })) },
		log: drizzleKnowledgeUseLog(db),
		now: () => now,
	});
	return (await read({ projectId })).use;
}
