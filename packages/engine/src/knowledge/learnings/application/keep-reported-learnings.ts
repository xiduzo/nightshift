import type { AgentEvent } from "@nightshift/agents/types";
import type { LearningStep } from "../domain/waiting";
import type { ProposeLearnings } from "./propose-learnings";

export type KeepReportedLearningsPorts = {
	/** `proposeLearnings`, bound by the wire. */
	propose(request: ProposeLearnings): Promise<void>;
};

/** A session's events, and the step of the run they are for. */
export type KeepReportedLearnings = {
	events: AsyncIterable<AgentEvent>;
	projectId: string;
	step: LearningStep;
};

/**
 * The session's events as they are, with the learnings of its reports
 * proposed for the run's step. A note that cannot be kept is left out:
 * the step goes on.
 */
export const keepReportedLearnings = (ports: KeepReportedLearningsPorts) =>
	async function* ({
		events,
		projectId,
		step,
	}: KeepReportedLearnings): AsyncGenerator<AgentEvent> {
		for await (const event of events) {
			if (event.type === "report" && event.learnings?.length) {
				await ports
					.propose({ projectId, step, notes: event.learnings })
					.catch((error) =>
						console.warn("The learnings of a step were not kept:", error),
					);
			}
			yield event;
		}
	};
