/**
 * @nightshift/client: the client logic that the web app and the phone app
 * share. The typed client of a Night Shift, the query and mutation options
 * of each vertical (with their polling rules), the stream of one run, the
 * view types derived from the API, the stream of the person's
 * notifications, the notify rules, and the glances (the widget and the
 * run on the lock screen). No DOM, no React Native, no Node or Bun:
 * `platform-free.test.ts` checks it.
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
	type GlanceSnapshot,
	type GlanceTone,
	glanceSnapshot,
	type RunProgress,
	runProgress,
	sameProgress,
	waitingText,
} from "./glance";
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
	flowLabel,
	followRun,
	groupRuns,
	hasEnded,
	type ItemState,
	type ItemSummary,
	markdownPreview,
	mergeSteps,
	nodeLabels,
	type PlacementChoice,
	placementChoices,
	type RunDetail,
	type RunGroup,
	type RunStatus,
	type RunStreamConnection,
	type RunSummary,
	retryDelay,
	runStatusLabel,
	type SessionSummary,
	type StepOutcome,
	type StepState,
	type StepSummary,
	stepName,
	stepPosition,
	stepState,
	type TranscriptEntry,
	type Wait,
	type WaitEvent,
	waitFor,
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
