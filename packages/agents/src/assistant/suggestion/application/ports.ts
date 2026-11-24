import type { SuggestSessionEvent } from "../domain/session";
import type { AssistantVia } from "./suggest-field";

/**
 * Sessions the suggestion use case needs.
 * @filledBy agents/assistant
 */
export type SuggestSessions = {
	runReport(
		via: AssistantVia,
		input: {
			prompt: string;
			report: { output?: Record<string, unknown> };
			resumeSessionId?: string;
			signal: AbortSignal;
		},
	): AsyncGenerator<SuggestSessionEvent>;
};
