import type { AssistantVia, SuggestSessionEvent } from "../domain/session";

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
