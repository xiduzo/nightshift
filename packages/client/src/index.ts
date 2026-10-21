/**
 * @nightshift/client: the client logic that the web app and the phone app
 * share. The typed client of a Night Shift, the query and mutation options
 * of each vertical (with their polling rules), the stream of one run, the
 * view types derived from the API, the stream of the person's
 * notifications, and the notify rules. No DOM, no React
 * Native, no Node or Bun: `platform-free.test.ts` checks it.
 */

export {
	type ApiClient,
	type ApiInputs,
	type ApiOutputs,
	type ApiQueryUtils,
	type ApiTransport,
	createApiClient,
	createQueryUtils,
	isSignInRequired,
	isTwoFactorRequired,
} from "./api";
export {
	type ActivityRange,
	createDashboardQueries,
	type DashboardSummary,
	type FlowHealthRow,
	type FlowRange,
	type FlowRun,
	type GateState,
	type HourRange,
	type NightRange,
	type NightsRange,
	type Spread,
} from "./dashboard";
export {
	createDeviceMutations,
	createDeviceQueries,
	createOfferMutations,
	createOfferQueries,
	type DevicesOverview,
	type LinkedHost,
	type OfferView,
	type PairedDevice,
	type PairingReview,
	type SpaceDevice,
	type ThisComputer,
} from "./devices";
export {
	createFlowMutations,
	createFlowQueries,
	type FlowListItem,
	filledInputs,
	type InputTexts,
	jsonProblem,
	missingInputs,
} from "./flows";
export {
	type ContextItem,
	changesInbox,
	createGateMutations,
	createGateQueries,
	type GateChoice,
	type GateLink,
	gateParts,
	gateRun,
	inboxOrder,
	isGateClosed,
	type OpenGate,
	parseGateQuestion,
	waitedText,
	waitingForYou,
} from "./gates";
export {
	applySettingsPatch,
	createNotificationMutations,
	createNotificationQueries,
	describeNotice,
	followNotifications,
	type NotificationItem,
	type NotificationScreen,
	type NotificationSettings,
	type NotificationSettingsPatch,
} from "./notifications";
export {
	createProjectMutations,
	createProjectQueries,
	type GitInstall,
	type Project,
	type ProjectCheck,
} from "./projects";
export {
	type AgentErrorKind,
	type AgentMessages,
	type AgentUsage,
	applyAgentMessages,
	costLabel,
	createRunMutations,
	createRunQueries,
	currentStep,
	defaultPlacement,
	followRun,
	groupRuns,
	hasEnded,
	type ItemState,
	type ItemSummary,
	markdownPreview,
	mergeSteps,
	type PlacementChoice,
	placementChoices,
	type RunDetail,
	type RunGroup,
	type RunStatus,
	type RunStreamConnection,
	type RunSummary,
	type SessionSummary,
	type StepOutcome,
	type StepState,
	type StepSummary,
	stepState,
	type TranscriptEntry,
	type WaitEvent,
	whenLabel,
} from "./runs";
export {
	createScheduleMutations,
	createScheduleQueries,
	type ScheduleIssue,
	type ScheduleResult,
	type ScheduleSummary,
} from "./schedules";
export {
	createSpaceMutations,
	createSpaceQueries,
	type InvitationView,
	type MembersOverview,
	type PendingInvitation,
	type SpaceMember,
	type SpaceRole,
} from "./spaces";
