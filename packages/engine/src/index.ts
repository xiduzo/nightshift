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
	type ArchiveHost,
	type ArchiveRef,
	createSpaceArchive,
	type SpaceArchive,
	type WalkFile,
	type WalkRef,
} from "./archive";
export {
	type Artifact,
	createArtifactStore,
} from "./artifacts";
export type { RunCopies } from "./cleanup";
export type {
	Actor,
	DeviceDirectory,
	DeviceProfile,
	LeaseAnswer,
	LeaseHost,
	LeaseTake,
	NodeToPlace,
	OwnDevice,
	Placement,
	Relay,
	RunCommandInput,
	StartRunInput,
} from "./contract";
export {
	COMMAND_KINDS,
	HOST_UNREACHABLE,
	HostUnreachableError,
	OLDER_HOST,
	OlderHostError,
	permissionOf,
	runCommandSchema,
	startRunInputSchema,
} from "./contract";
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
export {
	createSyncedDocuments,
	documentName,
	documentRows,
	type SyncedDocuments,
} from "./documents";
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
	cliToolsOfSecrets,
	connectionsInUse,
	createFlowDocuments,
	flowsForRun,
	profilesInUse,
	revisionKinds,
} from "./flows";
export {
	type AskedQuestion,
	createKnowledge,
	createKnowledgeFolderLocks,
	type Knowledge,
	type KnowledgeEvaluation,
	type KnowledgeFile,
	type KnowledgeFolderLocks,
	type KnowledgeHit,
	type KnowledgeMap,
	type KnowledgeMeaningStatus,
	type KnowledgeQuestion,
	type KnowledgeText,
	type KnowledgeUseReport,
	LOCAL_ONLY_BYTES,
	type WaitingLearning,
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
	RUN_END_REASONS,
	RUN_NOT_FOUND,
	withoutPrivatePaths,
} from "./log";
export type { NodeMemory } from "./memory";
export {
	createOllama,
	type OllamaEndpoint,
	type OllamaModel,
	type OllamaService,
	type OllamaStatus,
} from "./ollama";
export {
	type OfferedPlacement,
	type PlacedDevice,
	type PlanDevices,
	type PlanInput,
	type PlannedRun,
	planNodes,
	UNREACHABLE_DEVICE,
} from "./placement";
export type {
	FeedStep,
	InboxAnsweredGate,
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
	answeredOf,
	exportRun,
	INBOX_KEEP_MS,
	inboxOf,
	lockScreenRefusal,
	NEEDED_YOU_REASONS,
	type RunBundleSummary,
} from "./read";
export type {
	Engine,
	EngineOptions,
	MoveRows,
	PeerContext,
	PeerProfiles,
	PeerProjects,
	Peers,
	SpaceEngine,
} from "./run";
export { createEngine, GateClosedError, START_DEADLINE_MS } from "./run";
export type {
	ScheduleList,
	ScheduleMissed,
	SchedulePause,
	WebhookAnswer,
} from "./schedules";
export type { UsageMoment, UsageNotes } from "./usage";
export type { KeptValue } from "./variables";
