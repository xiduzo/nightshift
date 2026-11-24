import type { ExplanationEvent } from "@nightshift/flows";
import { explanationPrompt } from "../catalog";
import { type AuthoringRun, runReport } from "../domain/authoring";
import type { AssistantVia, Sessions } from "../sessions";

/** The most characters of an answer: a few sentences. */
const ANSWER_LIMIT = 1_200;

export type ExplainRunInput = {
	run: AuthoringRun;
	via: AssistantVia;
	signal: AbortSignal;
};

export const explainRun = (ports: Pick<Sessions, "runReport">) =>
	async function* (input: ExplainRunInput): AsyncGenerator<ExplanationEvent> {
		for await (const event of ports.runReport(input.via, {
			prompt: explanationPrompt(
				runReport(input.run, input.run.flow, "The flow"),
			),
			report: {},
			signal: input.signal,
		})) {
			switch (event.type) {
				case "activity":
				case "usage":
					yield event;
					break;
				case "error":
					yield { type: "error", message: event.message };
					return;
				case "end": {
					// A harness that ends without a report answered in its text.
					const answer = plain(event.report?.summary || event.text);
					if (answer === "") {
						yield {
							type: "error",
							message: "The agent stopped without an answer. Ask again.",
						};
						return;
					}
					yield { type: "answer", answer };
					yield { type: "done" };
					return;
				}
				default:
					break;
			}
		}
	};

function plain(text: string): string {
	const flat = text
		.replace(/\*\*|__|`/g, "")
		.replace(/^#+\s*/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return flat.length > ANSWER_LIMIT
		? `${flat.slice(0, ANSWER_LIMIT - 1).trimEnd()}…`
		: flat;
}
