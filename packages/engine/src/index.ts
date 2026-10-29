/**
 * The public surface of the engine: what `@nightshift/devices`, the API, the
 * daemon and their tests import. A type is also here when the API's router type names it,
 * because the router declaration must be able to name it. Remove a name
 * that nothing outside the engine imports.
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
export {
	addHarness,
	type CliTool,
	type CliToolStore,
	type Connection,
	type ConnectionStore,
	cliToolGitSchema,
	cliToolInputSchema,
	connectionInputSchema,
	createDeviceCopies,
	customAgentOf,
	type DeviceCopies,
	type DeviceCopy,
	type DeviceDocument,
	deviceDocumentName,
	documentRows,
	HARNESS_BIN,
	isHostAddress,
	isLoopbackHost,
	type KeyStoreKind,
	openConfigStores,
	openDeviceDocument,
	type ProfileStore,
	type ProfileView,
	profileChoice,
	refreshDeviceFacts,
	removeCliTool,
	removeConnection,
	removeHarness,
	type SecretSource,
	type SecretView,
	type SettingField,
	type SettingKey,
	type SettingsStore,
	saveConnection,
	saveCustomAgent,
	saveProfile,
	secretStore,
	settingsPatchSchema,
	settingsSchema,
	storedDeviceCopy,
	valueStore,
} from "./device-config";
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
export type {
	CopyStamp,
	LoggedEvent,
	PlacedRun,
	TranscriptEntry,
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
export type { ListedProject, Project, SpaceDocument } from "./projects";
export {
	type Branches,
	checkProjectFolder,
	clonePathOf,
	createGitHubClones,
	createProjectCopies,
	createSpaceDocuments,
	deviceNameIn,
	type GitHubAccess,
	type GitHubClone,
	type GitHubClones,
	type GitHubRepo,
	type GitInstall,
	memberName,
	memberRole,
	PROJECT_NOT_FOUND,
	type ProjectCopies,
	type ProjectCopy,
	type ProjectReadiness,
	projectClones,
	projectRowsOf,
	recordClone,
	type SpaceDocuments,
	setUpGit,
	spaceProjectRows,
	systemGitInstaller,
	worktreeLocation,
} from "./projects";
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
