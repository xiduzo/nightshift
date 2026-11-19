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
export {
	type AnswerCost,
	HELP_AGENTS,
	type SentAnswerCost,
	type ServedAnswerCost,
	sharedAnswerCosts,
} from "./assistant";
export type { RunFiles } from "./cleanup";
export type {
	Actor,
	DeviceDirectory,
	DeviceProfile,
	LeaseAnswer,
	LeaseHost,
	LeaseTake,
	NodeToPlace,
	OwnDevice,
	PersonActor,
	Placement,
	Relay,
	RunCommandInput,
	StartRunInput,
	TestRunRequest,
} from "./contract";
export {
	COMMAND_KINDS,
	HOST_UNREACHABLE,
	HostUnreachableError,
	OLDER_HOST,
	OlderHostError,
	permissionOf,
	personOf,
	runCommandSchema,
	startRunInputSchema,
	startRunRequestSchema,
	startTestInputSchema,
} from "./contract";
export {
	CHANGE_TRENDS,
	CHANGE_VERDICTS,
	COST_STEADINESS,
	type DashboardSummary,
	type FlowChanges,
	type FlowHealthDetail,
	flowChanges,
	flowTurnedSevere,
	isTimeZone,
	MOVE_GUARDS,
	MOVE_SETUP_CAUSES,
	projectDashboard,
	SAVING_KINDS,
	type SevereTurn,
	type SpaceSpend,
	spaceSpend,
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
	ReadFileInput,
	ReadFileResult,
	RestoredWorktree,
	RunFolder,
	RunRef,
	SessionEvent,
	SessionInput,
	ToolCallInput,
	ToolResult,
	WebRequestInput,
	WebRequestResult,
	Worktree,
} from "./device";
export {
	createToolLaunchers,
	type Harnesses,
	localDevice,
	type SignInResult,
	type ToolLaunchers,
} from "./device";
export {
	createSyncedDocuments,
	documentKind,
	documentName,
	documentRows,
	type SyncedDocuments,
} from "./documents";
export type { Engine } from "./engine";
export type { EngineOptions } from "./engine-options";
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
	type ConfigUse,
	createConfigUse,
	createFlowDocuments,
	flowsForRun,
	revisionKinds,
} from "./flows";
export {
	type AskedQuestion,
	type AskLearner,
	createKnowledge,
	createKnowledgeFolderLocks,
	createRunLearnings,
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
	type LinkLook,
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
export type { PeerContext, PeerProfiles, PeerProjects, Peers } from "./peers";
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
	RunStreamItem,
	RunSummary,
	RunTrace,
	RunWalker,
	StepDetail,
	StepTranscript,
} from "./read";
export {
	answeredOf,
	exportRun,
	INBOX_KEEP_MS,
	inboxOf,
	lockScreenRefusal,
	NEEDED_YOU_REASONS,
	RUNGS,
	type RunBundleSummary,
	runReading,
	transcriptLines,
} from "./read";
export { GateClosedError } from "./run";
export { createRunFolders, noRunFolders } from "./run-folders";
export {
	PinNotHereError,
	type RunHere,
	START_DEADLINE_MS,
} from "./runs";
export type {
	ScheduleList,
	ScheduleMissed,
	SchedulePause,
	WebhookAnswer,
} from "./schedules";
export type { SpaceEngine } from "./space-engine";
export type { MoveRows } from "./space-move";
export type { UsageMoment, UsageNotes } from "./usage";
export type { KeptValue } from "./variables";
export { createEngine } from "./wire";
