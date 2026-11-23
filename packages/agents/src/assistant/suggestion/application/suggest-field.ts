import type { SuggestionEvent, SuggestionRequest } from "@nightshift/flows";
import type { FlowPlace } from "@nightshift/flows";
import { retryPrompt } from "../../domain/prompts";
import type { AssistantReport } from "../../domain/session";
import type { AssistantSessions } from "../../application/ports";
import {
	cannotSuggest,
	checkSuggestion,
	SUGGESTION_ATTEMPTS,
	suggestionDataSchema,
} from "../domain/suggestion-rules";
import { readProjectFacts } from "../domain/project-facts";
import { suggestionPrompt } from "../domain/suggestion-prompt";

const sum = (a: import("@nightshift/flows").AssistantUsage, b: import("@nightshift/flows").AssistantUsage) => {
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

export const suggestField =
	(ports: { sessions: Pick<AssistantSessions, "runReport"> }) =>
	async function* (
		input: import("../domain/suggestion-rules").SuggestFieldInput,
	): AsyncGenerator<SuggestionEvent> {
		const { request, via, place, signal } = input;
		const refusal = cannotSuggest(request);
		if (refusal) {
			yield { type: "error", message: refusal };
			return;
		}
		const output = suggestionDataSchema(request.kind);
		const facts =
			request.kind === "command" && via.kind === "agent"
				? await readProjectFacts(via.cwd)
				: null;
		const first = suggestionPrompt(request, facts);
		let spent: import("@nightshift/flows").AssistantUsage | null = null;
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
			let last: import("@nightshift/flows").AssistantUsage | null = null;
			let report: AssistantReport | null = null;
			let ended = false;
			for await (const event of ports.sessions.runReport(via, {
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
				yield { type: "error", message: "The agent stopped without an answer." };
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