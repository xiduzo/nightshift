import type { AppRouterClient } from "@nightshift/api/client";
import type { AgentNode, Outcome } from "@nightshift/flows";
import type { InferClientInputs, InferClientOutputs } from "@orpc/client";

/**
 * Contract types, derived from the API client so the web app depends only on
 * `@nightshift/api` (and the browser-safe `@nightshift/flows`). They mirror
 * `@nightshift/engine/types` and `@nightshift/agents/types`.
 */

type Outputs = InferClientOutputs<AppRouterClient>;
type Inputs = InferClientInputs<AppRouterClient>;

export type Project = Outputs["projects"]["list"][number];
export type FlowListItem = Outputs["flows"]["list"][number];
export type LoadedFlow = Outputs["flows"]["get"];

export type RunSummary = Outputs["runs"]["list"][number];
export type RunDetail = Outputs["runs"]["get"];
export type StepSummary = RunDetail["steps"][number];
export type SessionSummary = StepSummary["sessions"][number];
/** One item of a Call step's visit (`each`). */
export type ItemSummary = StepSummary["items"][number];
export type ItemState = ItemSummary["state"];
export type StepScope = NonNullable<StepSummary["scope"]>;
export type RunStatus = RunSummary["status"];
export type StepOutcome = NonNullable<StepSummary["outcome"]>;
export type StartRunInput = Inputs["runs"]["start"];
export type RunTrigger = RunSummary["trigger"];

/** `.nightshift/schedules.json`, with the next start and the last result of each schedule. */
export type ScheduleList = Outputs["schedules"]["list"];
export type ScheduleSummary = ScheduleList["schedules"][number];
export type ScheduleResult = NonNullable<ScheduleSummary["last"]>;
export type ScheduleIssue = ScheduleSummary["issues"][number];

/** The Devices page: this computer, its Hosts, and the Person's paired Devices. */
export type DevicesOverview = Outputs["devices"]["list"];
export type ThisComputer = NonNullable<DevicesOverview["thisComputer"]>;
export type LinkedHost = ThisComputer["hosts"][number];
export type PairedDevice = DevicesOverview["devices"][number];
export type PairingReview = Outputs["devices"]["review"];
export type OfferView = Outputs["offers"]["list"]["offers"][number];
export type SpaceDevice = Outputs["devices"]["space"][number];

export type PermissionMode = NonNullable<AgentNode["permissionMode"]>;
export type Effort = NonNullable<AgentNode["effort"]>;
export type { Outcome };

export type RunStreamItem =
	Outputs["runs"]["watch"] extends AsyncIterable<infer Item> ? Item : never;
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
>;

/** A Gate that waits for a person: the Needs-you inbox. */
export type OpenGate = Outputs["gates"]["list"][number];
export type GateChoice = OpenGate["choices"][number];
export type AgentUsage = NonNullable<
	Extract<AgentEvent, { type: "finished" }>["usage"]
>;
export type AgentErrorKind = Extract<AgentEvent, { type: "error" }>["kind"];

/** The Members page: the Space, its Members, its pending invitations, and what you may change. */
export type MembersOverview = Outputs["members"]["list"];
export type SpaceMember = MembersOverview["members"][number];
export type PendingInvitation = MembersOverview["invitations"][number];
export type SpaceRole = SpaceMember["role"];
/** An invitation as its link's page shows it. */
export type InvitationView = Outputs["invitations"]["get"];
