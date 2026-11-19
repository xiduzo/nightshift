import type { AnswerCostStore } from "../../application/ports";
import type { KeptAnswerCost } from "../../domain/answer-costs";

/** One answer's cost as the twins keep it: what the real table holds. */
export type AnswerCostRecord = KeptAnswerCost & {
	/** Its number on this Replica, in the order it landed here. */
	seq: number;
	/** The Device that answered. Null: this computer. */
	deviceId: string | null;
	/** Its number on the Host of its Space. Null: none yet. */
	hostSeq: number | null;
	/** When the Host had it. Null: not yet. */
	sentAt: number | null;
};

/** The records of one Replica, shared by its twins (`inMemoryAnswerCostShare` reads them too). */
export type AnswerCostRecords = { rows: AnswerCostRecord[]; next: number };

export function answerCostRecords(): AnswerCostRecords {
	return { rows: [], next: 1 };
}

/** `AnswerCostStore` in memory, on the records of one Replica. */
export function inMemoryAnswerCostStore(
	records: AnswerCostRecords = answerCostRecords(),
) {
	const twin = {
		records,
		async add(cost: KeptAnswerCost) {
			records.rows.push({
				...cost,
				seq: records.next++,
				deviceId: null,
				hostSeq: null,
				sentAt: null,
			});
		},
		async list(spaceId: string, since?: number) {
			return records.rows
				.filter(
					(row) =>
						row.spaceId === spaceId && (since === undefined || row.at >= since),
				)
				.sort((a, b) => a.at - b.at || a.seq - b.seq)
				.map(
					({ seq: _, deviceId: __, hostSeq: ___, sentAt: ____, ...kept }) =>
						kept,
				);
		},
	};
	return twin satisfies AnswerCostStore;
}

export type InMemoryAnswerCostStore = ReturnType<
	typeof inMemoryAnswerCostStore
>;
