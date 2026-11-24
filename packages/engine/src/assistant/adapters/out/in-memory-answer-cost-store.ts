import type { AnswerCostStore } from "../../application/ports";
import type { KeptAnswerCost } from "../../domain/answer-costs";

/** `AnswerCostStore` in memory. */
export function inMemoryAnswerCostStore() {
	const rows: KeptAnswerCost[] = [];
	const twin = {
		async add(cost: KeptAnswerCost) {
			rows.push(cost);
		},
		async list(spaceId: string, since?: number) {
			return rows
				.filter(
					(row) =>
						row.spaceId === spaceId && (since === undefined || row.at >= since),
				)
				.sort((a, b) => a.at - b.at);
		},
	};
	return twin satisfies AnswerCostStore;
}
