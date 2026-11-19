import type { AnswerCostShare } from "../../application/ports";
import type {
	SentAnswerCost,
	ServedAnswerCost,
} from "../../domain/answer-costs";
import {
	type AnswerCostRecord,
	type AnswerCostRecords,
	answerCostRecords,
} from "./in-memory-answer-cost-store";

const sentOf = (row: AnswerCostRecord): SentAnswerCost => ({
	key: row.key,
	spaceId: row.spaceId,
	projectId: row.projectId,
	agent: row.agent,
	entry: row.entry,
	inputTokens: row.inputTokens,
	outputTokens: row.outputTokens,
	costUsd: row.costUsd,
	at: row.at,
});

/** `AnswerCostShare` in memory, on the records of one Replica. */
export function inMemoryAnswerCostShare(
	records: AnswerCostRecords = answerCostRecords(),
) {
	const has = (key: string) => records.rows.find((row) => row.key === key);
	const twin = {
		records,
		async unsent(spaces: readonly string[], limit: number) {
			return records.rows
				.filter(
					(row) =>
						spaces.includes(row.spaceId) &&
						row.deviceId === null &&
						row.sentAt === null,
				)
				.slice(0, limit)
				.map(sentOf);
		},
		async sent(keys: readonly string[], now: number) {
			for (const row of records.rows) {
				if (keys.includes(row.key) && row.sentAt === null) row.sentAt = now;
			}
		},
		async cursors(spaces: readonly string[]) {
			const cursors: Record<string, number> = {};
			for (const row of records.rows) {
				if (!spaces.includes(row.spaceId) || row.hostSeq === null) continue;
				cursors[row.spaceId] = Math.max(cursors[row.spaceId] ?? 0, row.hostSeq);
			}
			return cursors;
		},
		async ingest(rows: readonly ServedAnswerCost[], now: number) {
			for (const row of rows) {
				const kept = has(row.key);
				if (kept) {
					kept.hostSeq = row.seq;
					kept.sentAt ??= now;
					continue;
				}
				const { seq, ...fields } = row;
				records.rows.push({
					...fields,
					seq: records.next++,
					hostSeq: seq,
					sentAt: now,
				});
			}
		},
		async take(
			rows: readonly SentAnswerCost[],
			from: { deviceId: string; personId: string },
		) {
			for (const row of rows) {
				if (has(row.key)) continue;
				records.rows.push({
					...row,
					personId: from.personId,
					seq: records.next++,
					deviceId: from.deviceId,
					hostSeq: null,
					sentAt: null,
				});
			}
			return rows.map((row) => row.key);
		},
		async after(input: {
			spaces: readonly string[];
			cursors: Readonly<Record<string, number>>;
			selfId: string;
			limit: number;
		}) {
			return records.rows
				.filter(
					(row) =>
						input.spaces.includes(row.spaceId) &&
						row.seq > (input.cursors[row.spaceId] ?? 0),
				)
				.slice(0, input.limit)
				.map(
					(row): ServedAnswerCost => ({
						...sentOf(row),
						seq: row.seq,
						deviceId: row.deviceId ?? input.selfId,
						personId: row.personId,
					}),
				);
		},
	};
	return twin satisfies AnswerCostShare;
}

export type InMemoryAnswerCostShare = ReturnType<
	typeof inMemoryAnswerCostShare
>;
