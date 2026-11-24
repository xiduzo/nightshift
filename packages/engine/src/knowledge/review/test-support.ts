import type { Database } from "@nightshift/db";
import { event } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate, now as timeNow } from "@nightshift/time";
import { localSpaceId } from "../../testing/test-support";
import { drizzleKnowledgeUseLog } from "./adapters/out/drizzle-knowledge-use-log";
import { inMemoryReviewPorts } from "./adapters/out/in-memory-neighbours";
import { listAskedQuestions } from "./application/list-asked-questions";
import type { KnowledgeUseLog } from "./application/ports";
import { readKnowledgeUse } from "./application/read-knowledge-use";
import type {
	AskedQuestion,
	KnowledgeUseReport,
	KnowledgeUseRow,
} from "./domain/use";

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

/**
 * Every port of review: the log of uses over a database in memory, with
 * each read it was asked, and the others in memory. Where each use-case
 * test starts.
 */
export async function reviewPorts() {
	const db = await migratedDb();
	const spaceId = await localSpaceId(db);
	const log = drizzleKnowledgeUseLog(db);
	const reads: { projectId: string; limit: number; since?: number }[] = [];
	let seq = 0;
	return {
		...inMemoryReviewPorts(),
		/** Each read asked of the log, in order. */
		reads,
		log: {
			async events(projectId, types, options) {
				reads.push({ projectId, ...options });
				return log.events(projectId, types, options);
			},
		} satisfies KnowledgeUseLog,
		/** Logs a use of a project's knowledge, after the ones before. */
		async logUse(projectId: string, use: KnowledgeUseRow) {
			const { runId, stepId, at } = use;
			await db.insert(event).values({
				spaceId,
				runId,
				stepId,
				type: use.type,
				payload: JSON.stringify({ ...use.payload, projectId }),
				at: asDate(at),
				walkerId: "here",
				walkerSeq: ++seq,
			});
		},
	};
}
