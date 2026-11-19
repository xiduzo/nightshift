import type { SentAnswerCost } from "../domain/answer-costs";
import type { AnswerCostShare } from "./ports";

export type ListUnsentAnswerCostsPorts = {
	answerCostShare: Pick<AnswerCostShare, "unsent">;
};

/** The Spaces a Host keeps, and how many records at most. */
export type ListUnsentAnswerCosts = {
	spaces: readonly string[];
	limit: number;
};

/**
 * This computer's own answer costs in the Spaces a Host keeps that the
 * Host lacks, the oldest first. A Device asks before it sends them.
 */
export const listUnsentAnswerCosts =
	(ports: ListUnsentAnswerCostsPorts) =>
	(request: ListUnsentAnswerCosts): Promise<SentAnswerCost[]> =>
		ports.answerCostShare.unsent(request.spaces, request.limit);
