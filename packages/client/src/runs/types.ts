import type { ApiInputs, ApiOutputs } from "../api";

/** The view types of runs, their steps and their transcripts, derived from the API. */

export type RunSummary = ApiOutputs["runs"]["list"][number];
export type RunDetail = ApiOutputs["runs"]["get"];
export type StepSummary = RunDetail["steps"][number];
/** A file a run's agent kept for the person. */
export type Artifact = ApiOutputs["runs"]["artifacts"][number];
export type SessionSummary = StepSummary["sessions"][number];
/** One item of a Call step's visit (`each`). */
export type ItemSummary = StepSummary["items"][number];
export type ItemState = ItemSummary["state"];
export type StepScope = NonNullable<StepSummary["scope"]>;
export type RunStatus = RunSummary["status"];
/** How the End node that ended a run says it came out. */
export type RunResult = NonNullable<RunSummary["result"]>;
export type StepOutcome = NonNullable<StepSummary["outcome"]>;
export type StartRunInput = ApiInputs["runs"]["start"];
export type RunTrigger = RunSummary["trigger"];
/** A Device a run of the project can run on now (`runs.placements`). */
export type RunPlacement = ApiOutputs["runs"]["placements"][number];
/** One of the person's Devices for a project, online or not (`runs.devices`). */
export type RunDevice = ApiOutputs["runs"]["devices"][number];

/** One item of `runs.watch`: the run's status, a step summary, or a transcript entry. */
export type RunStreamItem =
	ApiOutputs["runs"]["watch"] extends AsyncIterable<infer Item> ? Item : never;
export type TranscriptEntry = Extract<
	RunStreamItem,
	{ kind: "transcript" }
>["entry"];
export type StepEvent = TranscriptEntry["event"];
export type CommandEvent = Extract<
	StepEvent,
	{ type: "command-start" | "command-output" | "command-exit" }
>;
export type DecisionEvent = Extract<
	StepEvent,
	{ type: "decision-start" | "decision" }
>;
export type GateEvent = Extract<
	StepEvent,
	{ type: "gate-open" | "gate-resolved" }
>;
export type ItemEvent = Extract<
	StepEvent,
	{ type: "items-read" | "item-start" | "item-end" }
>;
export type WaitEvent = Extract<StepEvent, { type: "wait" | "wake" }>;
export type ValueEvent = Extract<StepEvent, { type: "value-start" | "value" }>;
/** An End node's step: how it ends the run, and its message. */
export type EndEvent = Extract<StepEvent, { type: "end" }>;
/** A Tool node's call and the tool's answer. */
export type ToolNodeEvent = Extract<
	StepEvent,
	{ type: "tool-call" | "tool-called" }
>;
export type AgentEvent = Exclude<
	StepEvent,
	| CommandEvent
	| DecisionEvent
	| GateEvent
	| ItemEvent
	| WaitEvent
	| ValueEvent
	| ToolNodeEvent
	| EndEvent
>;
export type AgentUsage = NonNullable<
	Extract<AgentEvent, { type: "finished" }>["usage"]
>;
export type AgentErrorKind = Extract<AgentEvent, { type: "error" }>["kind"];
