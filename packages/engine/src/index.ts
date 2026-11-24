/**
 * The engine's door: the Engine and the Space engine with their ports, what
 * `@nightshift/devices` exchanges with them, and the views the API and the
 * daemon read. This computer's Device document has its own entry
 * (`./settings`), and so do the Projects and their Clones
 * (`./projects`). Test helpers are on `./testing`. A type is also here when
 * the API's router type names it, because the router declaration must be
 * able to name it. Remove a name that no other workspace's code imports.
 */

export { RunNotFound, SpaceNotFound, wireAccess, wireComputer } from "./access";
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
} from "./assistant";
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
	RowBatch,
	RunCommandInput,
	SecretUse,
	StartRunInput,
	TestRunRequest,
} from "./contract";
export {
	COMMAND_KINDS,
	HOST_UNREACHABLE,
	HostUnreachableError,
	NIGHT_SHIFT,
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
	isTimeZone,
	MOVE_GUARDS,
	MOVE_SETUP_CAUSES,
	SAVING_KINDS,
	type SevereTurn,
	type SpaceSpend,
	summarizeSpend,
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
	createFlowDocuments,
	createSpaceDocuments,
	createSyncedDocuments,
	type DeviceDocument,
	deviceDocumentName,
	deviceNameIn,
	documentKind,
	documentName,
	documentRows,
	type FlowDocuments,
	memberName,
	memberRole,
	openDeviceDocument,
	refreshDeviceFacts,
	type SpaceDocument,
	type SpaceDocuments,
	type SyncedDocuments,
} from "./documents";
export type { Engine, SharedAnswerCosts } from "./engine";
export type { EngineOptions } from "./engine-options";
export { LOCAL_ONLY_BYTES } from "./file-loaders";
export type {
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
	flowsForRun,
	revisionKinds,
	wireConfigUse as createConfigUse,
} from "./flows";
export {
	GateClosedError,
	INBOX_KEEP_MS,
	type InboxAnsweredGate,
	type InboxGate,
	NeedsApp,
} from "./gates";
export {
	type Branches,
	type GitInstall,
	worktreeLocation,
} from "./git";
export {
	type GitHubAccess,
	type GitHubRepo,
	systemGitHubCli,
} from "./github";
export { type KeyStoreKind, secretStore, valueStore } from "./key-store";
export {
	type AskedQuestion,
	type AskLearner,
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
	type LinkLook,
	measuredMeaning,
	type WaitingLearning,
	wireKnowledge,
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
export type {
	DeviceRows,
	PeerContext,
	PeerProfiles,
	PeerProjects,
	Peers,
} from "./peers";
export type {
	FeedStep,
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
	exportRun,
	NEEDED_YOU_REASONS,
	RUNGS,
	type RunBundleSummary,
	runReading,
	transcriptLines,
} from "./read";
export { createRunFolders, noRunFolders } from "./run-folders";
export type { RunFiles } from "./runs";
export {
	type OfferedPlacement,
	PinNotHereError,
	type PlacedDevice,
	type PlanDevices,
	type PlanInput,
	type PlannedRun,
	type RunHere,
	START_DEADLINE_MS,
	UNREACHABLE_DEVICE,
} from "./runs";
export type {
	ScheduleList,
	ScheduleMissed,
	SchedulePause,
	WebhookAnswer,
} from "./schedules";
export {
	type PersonalSecrets,
	type ProjectSecretName,
	type ProjectSecrets,
	type SecretScope,
	type SecretSource,
	type SecretView,
	unreachableNote,
} from "./secrets";
export type { SpaceEngine } from "./space-engine";
export type { MoveRows } from "./space-move";
export type { UsageMoment, UsageNotes } from "./usage";
export type { KeptValue } from "./variables";
export { createEngine } from "./wire";
export { planNodes } from "./wire-start";
