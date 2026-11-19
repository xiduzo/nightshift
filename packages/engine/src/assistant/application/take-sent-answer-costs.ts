import type { SentAnswerCost } from "../domain/answer-costs";
import type { AnswerCostShare } from "./ports";

export type TakeSentAnswerCostsPorts = {
	answerCostShare: Pick<AnswerCostShare, "take">;
};

/** What a Device sent, and the Device and Person it came from. */
export type TakeSentAnswerCosts = {
	rows: readonly SentAnswerCost[];
	from: { deviceId: string; personId: string };
};

/**
 * On a Host: keeps the answer costs a Device sent, as that Device's and
 * its Person's. An answer it has stays as it is. Returns the keys it has
 * now. The exchange checks the Spaces first.
 */
export const takeSentAnswerCosts =
	(ports: TakeSentAnswerCostsPorts) =>
	(request: TakeSentAnswerCosts): Promise<string[]> =>
		ports.answerCostShare.take(request.rows, request.from);
