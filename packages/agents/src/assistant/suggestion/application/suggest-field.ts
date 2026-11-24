import type {
	AssistantUsage,
	FlowPlace,
	SuggestionEvent,
	SuggestionRequest,
} from "@nightshift/flows";
import type { AssistantReport, AssistantVia, Sessions } from "../../sessions";
import { retryPrompt } from "../domain/flow-text";
import { suggestionPrompt } from "../domain/suggestion-prompt";
import {
	cannotSuggest,
	checkSuggestion,
	SUGGESTION_ATTEMPTS,
	suggestionDataSchema,
} from "../domain/suggestion-rules";
import type { ProjectFactsReader } from "./ports";

const sum = (a: AssistantUsage, b: AssistantUsage) => {
	const costUsd =
		a.costUsd !== undefined || b.costUsd !== undefined
			? (a.costUsd ?? 0) + (b.costUsd ?? 0)
			: undefined;
	return {
		inputTokens: a.inputTokens + b.inputTokens,
		outputTokens: a.outputTokens + b.outputTokens,
		...(costUsd !== undefined ? { costUsd } : {}),
	};
};

export type SuggestFieldInput = {
	request: SuggestionRequest;
	via: AssistantVia;
	place: FlowPlace;
	signal: AbortSignal;
};

export const suggestField = (
	ports: Pick<Sessions, "runReport"> & { readProjectFacts: ProjectFactsReader },
) =>
	async function* (input: SuggestFieldInput): AsyncGenerator<SuggestionEvent> {
		const { request, via, place, signal } = input;
		const refusal = cannotSuggest(request);
		if (refusal) {
			yield { type: "error", message: refusal };
			return;
		}
		const output = suggestionDataSchema(request.kind);
		const facts =
			request.kind === "command" && via.kind === "agent"
				? await ports.readProjectFacts(via.cwd)
				: null;
		const first = suggestionPrompt(request, facts);
		let spent: AssistantUsage | null = null;
		let sessionId: string | null = null;
		let problems: string[] = [];
		for (let attempt = 0; attempt < SUGGESTION_ATTEMPTS; attempt++) {
			const resume: string | undefined =
				attempt > 0 && sessionId ? sessionId : undefined;
			const prompt: string =
				attempt === 0
					? first
					: resume
						? retryPrompt(problems)
						: `${first}\n\n${retryPrompt(problems)}`;
			let last: AssistantUsage | null = null;
			let report: AssistantReport | null = null;
			let ended = false;
			for await (const event of ports.runReport(via, {
				prompt,
				...(resume ? { resumeSessionId: resume } : {}),
				report: { output },
				signal,
			})) {
				switch (event.type) {
					case "session":
						sessionId = event.sessionId;
						break;
					case "activity":
						yield event;
						break;
					case "usage":
						last = event.usage;
						yield {
							type: "usage",
							usage: spent ? sum(spent, event.usage) : event.usage,
						};
						break;
					case "error":
						yield { type: "error", message: event.message };
						return;
					case "end":
						if (event.sessionId) sessionId = event.sessionId;
						report = event.report;
						ended = true;
						break;
					default:
						break;
				}
			}
			if (last) spent = spent ? sum(spent, last) : last;
			if (!ended) {
				yield {
					type: "error",
					message: "The agent stopped without an answer.",
				};
				return;
			}
			if (!report) {
				problems = [
					"You ended without a report. Report the suggestion: the note in `summary`, the suggestion in `data`.",
				];
				continue;
			}
			const checked = checkSuggestion(request, report, place);
			if ("suggestion" in checked) {
				yield { type: "suggestion", suggestion: checked.suggestion };
				yield { type: "done" };
				return;
			}
			problems = checked.problems;
		}
		yield {
			type: "error",
			message: `The agent could not make a suggestion that works in this flow: ${problems[0] ?? "it gave no answer"} Try again, or say more in your instruction.`,
		};
	};
