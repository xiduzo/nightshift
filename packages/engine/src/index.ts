/**
 * The engine's door: the Engine and the Space engine with their ports, what
 * `@nightshift/devices` exchanges with them, and the views the API and the
 * daemon read. This computer's Device document has its own entry
 * (`./device-config`), and so do the Projects and their Clones
 * (`./projects`). Test helpers are on `./testing`. A type is also here when
 * the API's router type names it, because the router declaration must be
 * able to name it. Remove a name that no other workspace's code imports.
 */

export {
	type Artifact,
	createArtifactStore,
} from "./artifacts";
export type { RunCopies } from "./cleanup";
export type {
	Actor,
	DeviceDirectory,
	DeviceProfile,
	NodeToPlace,
	OwnDevice,
	Placement,
	Relay,
	RunCommandInput,
	RunCommandKind,
	StartRunInput,
} from "./contract";
export { startRunInputSchema } from "./contract";
export {
	type DashboardSummary,
	type FlowHealthDetail,
	isTimeZone,
	projectDashboard,
	spacesDashboard,
	summarizeFlow,
} from "./dashboard";
export type {
	Capabilities,
	CapabilityQuery,
	Device,
	ExecEvent,
	ExecInput,
	OfferedSessionInput,
	RunRef,
	SessionEvent,
	SessionInput,
	ToolCallInput,
	ToolResult,
	Worktree,
} from "./device";
export {
	createToolLaunchers,
	localDevice,
	type SignInResult,
	type ToolLaunchers,
} from "./device";
export type {
	FlowDocuments,
	FlowExport,
	FlowNotice,
	FlowRef,
	FlowRevisionItem,
	FlowRevisionView,
	SavedFlow,
	SpaceFlows,
} from "./flows";
export {
	cliToolsInUse,
	connectionsInUse,
	createFlowDocuments,
	documentSpace,
	flowsForRun,
	profilesInUse,
	revisionKinds,
} from "./flows";
export type { WalkFile, WalkRef } from "./graph";
export {
	createKnowledgeFolders,
	createKnowledgeSearch,
	KNOWLEDGE_FILES_WARNING,
	type KnowledgeFile,
	type KnowledgeFolders,
	type KnowledgeHit,
	type KnowledgeSearch,
	type KnowledgeText,
} from "./knowledge";
export type {
	CopyStamp,
	LoggedEvent,
	PlacedRun,
	TranscriptEntry,
	WorktreeChanges,
} from "./log";
export {
	ForeignRowsError,
	followOwnStep,
	MissingProjectError,
	parseTranscript,
	RUN_NOT_FOUND,
	stampHolds,
	withoutPrivatePaths,
} from "./log";
export type {
	FeedStep,
	InboxGate,
	LandedFact,
	OpenGate,
	ProjectRuns,
	RunDetail,
	RunHere,
	RunStreamItem,
	RunSummary,
	RunTrace,
	RunWalker,
	StepDetail,
} from "./read";
export {
	exportRun,
	inboxOf,
	lockScreenRefusal,
	type RunBundleSummary,
} from "./read";
export type {
	Engine,
	EngineOptions,
	MoveRows,
	OfferedPlacement,
	PeerContext,
	PeerProfiles,
	PeerProjects,
	Peers,
	PlacedDevice,
	PlanInput,
	PlannedRun,
	SpaceEngine,
} from "./run";
export {
	createEngine,
	GateClosedError,
	HOST_UNREACHABLE,
	HostUnreachableError,
	type PlanDevices,
	planNodes,
	UNREACHABLE_DEVICE,
} from "./run";
export type { ScheduleList, WebhookAnswer } from "./schedules";
export type { KeptValue } from "./variables";
