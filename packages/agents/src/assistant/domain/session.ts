/**
 * Types and rules of a design-time assistant session: what it streams, how
 * usage is settled, and how failures read to the person.
 */
import type { AssistantUsage } from "@nightshift/flows";
import { formatDateTime } from "@nightshift/time";

/** Kinds of agent failure the person may see: the harness port's kinds. */
type AgentErrorKind = "aborted" | "usage-limit" | "network" | "harness";

/** The most turns and the most money of one answer. */
export type SessionLimits = { turns?: number; usd?: number };

/** What the person reads when an answer stopped at its limit. */
export const AT_LIMIT =
	"The agent reached the most it may use for one answer. Ask again to continue.";

/** The step report of an assistant session. `data` is not checked yet. */
export type AssistantReport = { summary: string; data?: unknown };

export type AssistantSessionEvent =
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

/** Words for the person about a failed session. */
export function sessionErrorMessage(
	kind: AgentErrorKind,
	message: string,
	resetAt?: number,
): string {
	switch (kind) {
		case "aborted":
			return "Stopped.";
		case "usage-limit":
			return resetAt
				? `This agent reached its usage limit until ${formatDateTime(resetAt)}. Try again then, or choose another agent.`
				: "This agent reached its usage limit. Try again later, or choose another agent.";
		case "network":
			return "Night Shift could not reach the model. Check the internet connection, then try again.";
		default:
			return message.trim() || "The agent stopped with an error.";
	}
}

/** The session's total at its end versus the running total before it. */
export function settleUsage(
	live: AssistantUsage | null,
	end: AssistantUsage,
): AssistantUsage {
	if (
		!live ||
		(end.inputTokens >= live.inputTokens &&
			end.outputTokens >= live.outputTokens)
	) {
		return end;
	}
	const costs = [live.costUsd, end.costUsd].filter(
		(cost): cost is number => cost !== undefined,
	);
	return {
		inputTokens: Math.max(live.inputTokens, end.inputTokens),
		outputTokens: Math.max(live.outputTokens, end.outputTokens),
		...(costs.length > 0 ? { costUsd: Math.max(...costs) } : {}),
	};
}
