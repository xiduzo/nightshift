/**
 * The Learner of this computer (ADR 37): who answers when the engine looks
 * back at a run that ended. What the person chose for the Learner in
 * Settings (an agent or a model), else the first agent that works here, as
 * for the Explainer. An agent works in the assistant's own folder: the
 * evidence is in its prompt, and it reads no project. Each answer that
 * spent something keeps one record in the run's Space, in the name of
 * this computer's owner (ADR 36).
 */
import { learnFromRun } from "@nightshift/agents";
import type { AnswerCost, AskLearner } from "@nightshift/engine";
import type { AssistantUsage } from "@nightshift/flows";
import { now as timeNow } from "@nightshift/time";
import { type AssistantDeps, NO_LEARNER, reportAgentVia } from "./assistant";

export type LearnerDeps = Pick<
	AssistantDeps,
	"settings" | "profiles" | "decide" | "harnessFor" | "installed" | "ownFolder"
> & {
	/** Keeps what one answer cost. */
	keep: (cost: AnswerCost) => Promise<void>;
	/** This computer's owner: the Person a look back works for. */
	personId: string;
	now?: () => number;
};

const spent = (usage: AssistantUsage | null): usage is AssistantUsage =>
	usage !== null &&
	(usage.inputTokens > 0 || usage.outputTokens > 0 || (usage.costUsd ?? 0) > 0);

/** Asks this computer's Learner. Never throws: what fails is logged, and gives no notes. */
export function createLearner(deps: LearnerDeps): AskLearner {
	const now = deps.now ?? timeNow;
	return async ({ evidence, spaceId, projectId, signal }) => {
		const via = await reportAgentVia(
			deps,
			"learner",
			{},
			async () => (await deps.ownFolder?.()) ?? null,
			NO_LEARNER,
		);
		if ("error" in via) {
			console.warn("[learner] nothing can answer:", via.error);
			return [];
		}
		const answer = await learnFromRun({ evidence, via, signal });
		if (spent(answer.usage)) {
			await deps
				.keep({
					at: now(),
					agent: "learner",
					entry: null,
					projectId,
					spaceId,
					personId: deps.personId,
					inputTokens: answer.usage.inputTokens,
					outputTokens: answer.usage.outputTokens,
					costUsd: answer.usage.costUsd ?? null,
				})
				.catch((error: unknown) => {
					console.warn("[learner] could not keep the cost of an answer", error);
				});
		}
		if (answer.kind === "error") {
			console.warn("[learner] the Learner did not answer:", answer.message);
			return [];
		}
		return answer.notes;
	};
}
