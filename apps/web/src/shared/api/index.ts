/**
 * The oRPC client, the query client, the server URL, the auth client, and
 * the API types: the view types of `@nightshift/client`, and the ones only
 * the web app needs (contract.ts).
 */

export type {
	ActivityRange,
	AgentErrorKind,
	AgentUsage,
	DashboardSummary,
	FlowHealthRow,
	FlowListItem,
	FlowRange,
	FlowRun,
	GateChoice,
	GateState,
	GitInstall,
	HourRange,
	InvitationView,
	ItemState,
	ItemSummary,
	LinkedHost,
	MembersOverview,
	NightRange,
	NightsRange,
	OfferView,
	OpenGate,
	PairedDevice,
	PairingReview,
	PendingInvitation,
	Project,
	ProjectCheck,
	RunDetail,
	RunStatus,
	RunSummary,
	ScheduleIssue,
	ScheduleResult,
	ScheduleSummary,
	SessionSummary,
	SpaceDevice,
	SpaceMember,
	SpaceRole,
	Spread,
	StepOutcome,
	StepSummary,
	ThisComputer,
	TranscriptEntry,
	WaitEvent,
} from "@nightshift/client";
export { isSignInRequired, isTwoFactorRequired } from "@nightshift/client";
export { authClient } from "./auth-client";
export type {
	CheckTarget,
	CliCheck,
	CliTool,
	Connection,
	ConnectionList,
	Effort,
	HarnessRow,
	HarnessRowName,
	McpServer,
	McpTestResult,
	Outcome,
	PermissionMode,
	ProfileInput,
	ProfileRow,
	SecretSource,
	SecretView,
	SettingsView,
} from "./contract";
export { client, createQueryClient, orpc } from "./orpc";
export { SERVER_URL } from "./server-url";
