import type { AssistantUsage } from "@nightshift/flows";

/** The step report of an assistant session. `data` is not checked yet. */
export type AssistantReport = { summary: string; data?: unknown };

export type SuggestSessionEvent =
	| { type: "session"; sessionId: string }
	| { type: "activity"; text: string }
	| { type: "text"; delta: string }
	| { type: "usage"; usage: AssistantUsage }
	| { type: "error"; message: string; sessionId: string | null }
	| {
			type: "end";
			sessionId: string;
			report: AssistantReport | null;
			text: string;
	  };
