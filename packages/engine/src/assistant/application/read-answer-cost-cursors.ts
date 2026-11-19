import type { AnswerCostShare } from "./ports";

export type ReadAnswerCostCursorsPorts = {
	answerCostShare: Pick<AnswerCostShare, "cursors">;
};

/** The Spaces a Host keeps. */
export type ReadAnswerCostCursors = { spaces: readonly string[] };

/**
 * How far this Replica read the answer costs of each Space from its
 * Host: the last number it has from there. A Space it read nothing of is
 * left out.
 */
export const readAnswerCostCursors =
	(ports: ReadAnswerCostCursorsPorts) =>
	(request: ReadAnswerCostCursors): Promise<Record<string, number>> =>
		ports.answerCostShare.cursors(request.spaces);
