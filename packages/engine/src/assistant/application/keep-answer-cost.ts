import type { AnswerCost } from "../domain/answer-costs";
import type { AnswerCostStore } from "./ports";

export type KeepAnswerCostPorts = {
	answerCostStore: Pick<AnswerCostStore, "add">;
	/** A new key: the answer on every Replica. */
	newKey: () => string;
};

/**
 * Keeps what one answer of one of Night Shift's own agents cost on this
 * computer, under a new key. Night Shift asks, when the answer ends.
 */
export const keepAnswerCost =
	(ports: KeepAnswerCostPorts) =>
	async (request: AnswerCost): Promise<void> => {
		await ports.answerCostStore.add({ ...request, key: ports.newKey() });
	};
