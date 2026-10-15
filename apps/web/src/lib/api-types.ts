import type { AppRouterClient } from "@nightshift/api/routers/index";
import type { InferClientInputs, InferClientOutputs } from "@orpc/client";

/**
 * Contract types, derived from the API client so the web app depends only on
 * `@nightshift/api`. They mirror `@nightshift/engine/types` and
 * `@nightshift/agents/types`.
 */

type Outputs = InferClientOutputs<AppRouterClient>;
type Inputs = InferClientInputs<AppRouterClient>;

export type Project = Outputs["projects"]["list"][number];
export type RunSummary = Outputs["runs"]["list"][number];
export type RunDetail = Outputs["runs"]["get"];
export type SessionSummary = RunDetail["sessions"][number];
export type RunStatus = RunSummary["status"];
export type PermissionMode = RunSummary["permissionMode"];
export type Effort = NonNullable<RunSummary["effort"]>;
export type StartRunInput = Inputs["runs"]["start"];

export type RunStreamItem =
	Outputs["runs"]["watch"] extends AsyncIterable<infer Item> ? Item : never;
export type TranscriptEntry = Extract<
	RunStreamItem,
	{ kind: "transcript" }
>["entry"];
export type AgentEvent = TranscriptEntry["event"];
export type AgentUsage = NonNullable<
	Extract<AgentEvent, { type: "finished" }>["usage"]
>;
export type AgentErrorKind = Extract<AgentEvent, { type: "error" }>["kind"];
