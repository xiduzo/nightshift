import type { AnswerCostShare } from "./ports";

export type MarkAnswerCostsSentPorts = {
	answerCostShare: Pick<AnswerCostShare, "sent">;
};

/** The keys the Host has now, and when it said so. */
export type MarkAnswerCostsSent = { keys: readonly string[]; now: number };

/** The Host has these answer costs: a Device does not send them again. */
export const markAnswerCostsSent =
	(ports: MarkAnswerCostsSentPorts) =>
	(request: MarkAnswerCostsSent): Promise<void> =>
		ports.answerCostShare.sent(request.keys, request.now);
