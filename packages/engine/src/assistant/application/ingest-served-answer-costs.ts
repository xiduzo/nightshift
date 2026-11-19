import type { ServedAnswerCost } from "../domain/answer-costs";
import type { AnswerCostShare } from "./ports";

export type IngestServedAnswerCostsPorts = {
	answerCostShare: Pick<AnswerCostShare, "ingest">;
};

/** What the Host served, and when it came. */
export type IngestServedAnswerCosts = {
	rows: readonly ServedAnswerCost[];
	now: number;
};

/**
 * Keeps the answer costs a Host served. An answer this computer has (its
 * own, or one served before) takes the Host's number and stays as it is.
 */
export const ingestServedAnswerCosts =
	(ports: IngestServedAnswerCostsPorts) =>
	(request: IngestServedAnswerCosts): Promise<void> =>
		ports.answerCostShare.ingest(request.rows, request.now);
