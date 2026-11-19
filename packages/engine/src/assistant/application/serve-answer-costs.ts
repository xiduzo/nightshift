import type { ServedAnswerCost } from "../domain/answer-costs";
import type { AnswerCostShare } from "./ports";

export type ServeAnswerCostsPorts = {
	answerCostShare: Pick<AnswerCostShare, "after">;
};

/** The Spaces, the reader's cursor in each, this Host's Device id, and how many at most. */
export type ServeAnswerCosts = {
	spaces: readonly string[];
	cursors: Readonly<Record<string, number>>;
	selfId: string;
	limit: number;
};

/**
 * On a Host: the answer costs of the Spaces after each Space's cursor, in
 * the order they landed here. This Host is the Device of its own answers.
 */
export const serveAnswerCosts =
	(ports: ServeAnswerCostsPorts) =>
	(request: ServeAnswerCosts): Promise<ServedAnswerCost[]> =>
		ports.answerCostShare.after(request);
