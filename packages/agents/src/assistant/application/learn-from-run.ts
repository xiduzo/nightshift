import type { AssistantUsage } from "@nightshift/flows";
import {
	LEARN_OUTPUT,
	learnFromRunPrompt,
	type RunLearnings,
	reportedLearnings,
} from "../catalog";
import type { AssistantVia, Sessions } from "../sessions";

export const learnFromRun =
	(ports: Pick<Sessions, "runReport">) =>
	async (input: {
		evidence: string;
		via: AssistantVia;
		signal: AbortSignal;
	}): Promise<RunLearnings> => {
		let usage: AssistantUsage | null = null;
		for await (const event of ports.runReport(input.via, {
			prompt: learnFromRunPrompt(input.evidence),
			report: { output: LEARN_OUTPUT },
			signal: input.signal,
		})) {
			switch (event.type) {
				case "usage":
					usage = event.usage;
					break;
				case "error":
					return { kind: "error", message: event.message, usage };
				case "end":
					return {
						kind: "learned",
						notes: reportedLearnings(event.report?.data),
						usage,
					};
				default:
					break;
			}
		}
		return { kind: "error", message: "The Learner gave no answer.", usage };
	};
