/**
 * Types and rules of a design-time assistant session: what it streams, how
 * usage is settled, and how failures read to the person.
 */
import type { AgentProfileSettings, AssistantUsage } from "@nightshift/flows";
import { formatDateTime } from "@nightshift/time";
/** Kinds of agent failure the person may see. */
export type AgentErrorKind =
	| "aborted"
	| "usage-limit"
	| "network"
	| "harness"
	| "auth"
	| "other";

/** The harness handle a session needs (opaque to domain rules). */
export type SessionHarness = {
	name: string;
	label?: string;
};

/** A tool the session may hand the harness. */
export type SessionTool = { name: string };

/** The most turns and the most money of one answer. */
export type SessionLimits = { turns?: number; usd?: number };

/** What the person reads when an answer stopped at its limit. */
export const AT_LIMIT =
	"The agent reached the most it may use for one answer. Ask again to continue.";

/** The step report of an assistant session. `data` is not checked yet. */
export type AssistantReport = { summary: string; data?: unknown };

export type AssistantSessionInput = {
	/** The harness that answers, as this computer runs it. */
	harness: SessionHarness;
	profile: Pick<AgentProfileSettings, "model" | "effort">;
	cwd: string;
	prompt: string;
	resumeSessionId?: string;
	tools?: readonly SessionTool[];
	describeTool?: (name: string, input: unknown) => string | undefined;
	report?: { output?: Record<string, unknown> };
	limits?: SessionLimits;
	signal: AbortSignal;
};

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

/** An agent of this computer answers: a read-only session in a folder. */
export type AgentVia = {
	kind: "agent";
	harness: SessionHarness;
	profile: Pick<AgentProfileSettings, "model" | "effort">;
	cwd: string;
	limits?: SessionLimits;
};

/** A model answers: one call that returns the report. */
export type ModelVia = {
	kind: "model";
	ask: (input: {
		prompt: string;
		output: Record<string, unknown>;
		signal: AbortSignal;
	}) => Promise<unknown>;
};

export type AssistantVia = AgentVia | ModelVia;
