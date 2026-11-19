import type { Database } from "@nightshift/db";
import { answerCost } from "@nightshift/db/schema";
import { asDate, instant } from "@nightshift/time";
import { and, asc, eq, gte } from "drizzle-orm";
import type { AnswerCostStore } from "../../application/ports";

/**
 * `AnswerCostStore` over drizzle: one row per answer in `answer_cost`.
 * `wireAssistant` builds it. A Space move takes the rows of its Projects
 * along (`spaceMoveBatch`).
 */
export function drizzleAnswerCostStore(db: Database): AnswerCostStore {
	return {
		async add(cost) {
			await db.insert(answerCost).values({
				key: cost.key,
				spaceId: cost.spaceId,
				projectId: cost.projectId,
				personId: cost.personId,
				agent: cost.agent,
				entry: cost.entry,
				inputTokens: cost.inputTokens,
				outputTokens: cost.outputTokens,
				costUsd: cost.costUsd,
				at: asDate(cost.at),
			});
		},
		async list(spaceId, since) {
			const rows = await db
				.select()
				.from(answerCost)
				.where(
					and(
						eq(answerCost.spaceId, spaceId),
						since !== undefined ? gte(answerCost.at, asDate(since)) : undefined,
					),
				)
				.orderBy(asc(answerCost.at), asc(answerCost.id));
			return rows.map((row) => ({
				key: row.key,
				at: instant(row.at),
				agent: row.agent,
				entry: row.entry,
				projectId: row.projectId,
				spaceId: row.spaceId,
				personId: row.personId,
				inputTokens: row.inputTokens,
				outputTokens: row.outputTokens,
				costUsd: row.costUsd,
			}));
		},
	};
}
