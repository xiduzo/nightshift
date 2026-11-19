import type { Database } from "@nightshift/db";
import { answerCost } from "@nightshift/db/schema";
import { asDate, instant } from "@nightshift/time";
import { and, asc, eq, gt, inArray, isNull, max, or, sql } from "drizzle-orm";
import type { AnswerCostShare } from "../../application/ports";
import type { SentAnswerCost } from "../../domain/answer-costs";

/**
 * `AnswerCostShare` over drizzle, on `answer_cost`: `device_id` null is
 * this computer's own answer, `host_seq` the number the Host gave it,
 * `sent_at` when the Host had it. `wireAssistant` builds it.
 */
export function drizzleAnswerCostShare(db: Database): AnswerCostShare {
	return {
		async unsent(spaces, limit) {
			if (spaces.length === 0) return [];
			const rows = await db
				.select()
				.from(answerCost)
				.where(
					and(
						inArray(answerCost.spaceId, [...spaces]),
						isNull(answerCost.deviceId),
						isNull(answerCost.sentAt),
					),
				)
				.orderBy(asc(answerCost.id))
				.limit(limit);
			return rows.map(sentRow);
		},

		async sent(keys, now) {
			if (keys.length === 0) return;
			await db
				.update(answerCost)
				.set({ sentAt: asDate(now) })
				.where(
					and(inArray(answerCost.key, [...keys]), isNull(answerCost.sentAt)),
				);
		},

		async cursors(spaces) {
			if (spaces.length === 0) return {};
			const rows = await db
				.select({ spaceId: answerCost.spaceId, seq: max(answerCost.hostSeq) })
				.from(answerCost)
				.where(inArray(answerCost.spaceId, [...spaces]))
				.groupBy(answerCost.spaceId);
			return Object.fromEntries(
				rows.flatMap((row) =>
					row.seq === null ? [] : [[row.spaceId, row.seq] as const],
				),
			);
		},

		async ingest(rows, now) {
			for (const row of rows) {
				await db
					.insert(answerCost)
					.values({
						key: row.key,
						spaceId: row.spaceId,
						projectId: row.projectId,
						personId: row.personId,
						agent: row.agent,
						entry: row.entry,
						inputTokens: row.inputTokens,
						outputTokens: row.outputTokens,
						costUsd: row.costUsd,
						at: asDate(row.at),
						deviceId: row.deviceId,
						hostSeq: row.seq,
						sentAt: asDate(now),
					})
					.onConflictDoUpdate({
						target: answerCost.key,
						set: {
							hostSeq: row.seq,
							sentAt: sql`coalesce(${answerCost.sentAt}, ${now})`,
						},
					});
			}
		},

		async take(rows, from) {
			for (const row of rows) {
				await db
					.insert(answerCost)
					.values({
						key: row.key,
						spaceId: row.spaceId,
						projectId: row.projectId,
						personId: from.personId,
						agent: row.agent,
						entry: row.entry,
						inputTokens: row.inputTokens,
						outputTokens: row.outputTokens,
						costUsd: row.costUsd,
						at: asDate(row.at),
						deviceId: from.deviceId,
					})
					.onConflictDoNothing({ target: answerCost.key });
			}
			return rows.map((row) => row.key);
		},

		async after(input) {
			if (input.spaces.length === 0) return [];
			const rows = await db
				.select()
				.from(answerCost)
				.where(
					or(
						...input.spaces.map((spaceId) =>
							and(
								eq(answerCost.spaceId, spaceId),
								gt(answerCost.id, input.cursors[spaceId] ?? 0),
							),
						),
					),
				)
				.orderBy(asc(answerCost.id))
				.limit(input.limit);
			return rows.map((row) => ({
				...sentRow(row),
				seq: row.id,
				deviceId: row.deviceId ?? input.selfId,
				personId: row.personId,
			}));
		},
	};
}

function sentRow(row: typeof answerCost.$inferSelect): SentAnswerCost {
	return {
		key: row.key,
		spaceId: row.spaceId,
		projectId: row.projectId,
		agent: row.agent,
		entry: row.entry,
		inputTokens: row.inputTokens,
		outputTokens: row.outputTokens,
		costUsd: row.costUsd,
		at: instant(row.at),
	};
}
