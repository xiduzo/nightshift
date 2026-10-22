/**
 * The public surface of the engine: what `@nightshift/devices`, the API, the
 * daemon and their tests import. A type is also here when the API's router type names it,
 * because the router declaration must be able to name it. Remove a name
 * that nothing outside the engine imports.
 */

export {
	type Artifact,
	type ArtifactStore,
	createArtifactStore,
} from "./artifacts";
export type {
	Actor,
	DeviceDirectory,
	Engine,
	EngineOptions,
	FeedStep,
	OfferedPlacement,
	OwnDevice,
	PeerContext,
	Peers,
	PlacedDevice,
	Placement,
	Relay,
	RunCommandInput,
	RunCommandKind,
	SpaceEngine,
	StartRunInput,
	WalkFile,
	WalkFiles,
	WalkRef,
} from "./contract";
export {
	type DashboardSummary,
	type FlowHealthDetail,
	HOUR_RANGES,
	isTimeZone,
	NIGHT_RANGES,
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
export { localDevice } from "./device";
export {
	addHarness,
	type CliTool,
	type CliToolStore,
	type Connection,
	type ConnectionStore,
	cliToolInputSchema,
	connectionInputSchema,
	createCliToolStore,
	createConnectionStore,
	createProfileStore,
	createSettingsStore,
	customAgentOf,
	type DeviceDocument,
	deviceDocumentName,
	documentRows,
	HARNESS_BIN,
	isHostAddress,
	isLoopbackHost,
	type KeyStoreKind,
	openDeviceDocument,
	type ProfileStore,
	type ProfileView,
	refreshDeviceFacts,
	removeCliTool,
	removeConnection,
	removeHarness,
	type SecretSource,
	type SecretView,
	type SettingField,
	type SettingKey,
	type Settings,
	type SettingsStore,
	saveConnection,
	saveCustomAgent,
	saveProfile,
	secretStore,
	settingsPatchSchema,
	settingsSchema,
	valueStore,
} from "./device-config";
export type { FlowRef, FlowUse } from "./flows";
export { flowsForRun } from "./flows";
export type {
	HistoryCursors,
	HistoryRows,
	LandedRunEvent,
	LandedRunListener,
	LoggedEvent,
	OwnStepFiles,
	RunBus,
	RunHistory,
	RunLog,
	RunRow,
	RunStatus,
	TranscriptEntry,
} from "./log";
export {
	ForeignRowsError,
	followOwnStep,
	MissingProjectError,
	parseTranscript,
} from "./log";
export type { ListedProject, Project, SpaceDocument } from "./projects";
export {
	type Branches,
	checkProjectFolder,
	clonePathOf,
	createSpaceDocuments,
	deviceNameIn,
	type GitInstall,
	memberRole,
	NOT_ON_THIS_COMPUTER,
	type ProjectReadiness,
	projectClones,
	recordClone,
	type SpaceDocuments,
	setUpGit,
	spaceDocumentName,
	spaceIdOf,
	systemGitInstaller,
	worktreeLocation,
} from "./projects";
export type {
	OpenGate,
	RunDetail,
	RunStreamItem,
	RunSummary,
	RunWalker,
} from "./read";
export {
	deriveSteps,
	exportRun,
	openRunBundle,
	type RunBundleSummary,
} from "./read";
export { createEngine, GateClosedError } from "./run";
export type { ScheduleList } from "./schedules";
