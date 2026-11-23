import type { AgentProfileSettings, AssistantUsage } from "@nightshift/flows";

/** The step report of an assistant session. `data` is not checked yet. */
export type AssistantReport = { summary: string; data?: unknown };

export type SessionLimits = { turns?: number; usd?: number };

/** The harness handle a session needs. */
export type SessionHarness = {
	name: string;
	label?: string;
};

export type AgentVia = {
	kind: "agent";
	harness: SessionHarness;
	profile: Pick<AgentProfileSettings, "model" | "effort">;
	cwd: string;
	limits?: SessionLimits;
};

export type ModelVia = {
	kind: "model";
	decider: string;
	model: string;
	cwd?: string;
};

export type AssistantVia = AgentVia | ModelVia;

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
