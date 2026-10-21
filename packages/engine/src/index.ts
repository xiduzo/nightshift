/**
 * The public surface of the engine: what the API, the server and their
 * tests import. A type is also here when the API's router type names it,
 * because the router declaration must be able to name it. Remove a name
 * that nothing outside the engine imports.
 */

export type {
	Engine,
	FeedStep,
	OwnDevice,
	Placement,
	Relay,
	SpaceEngine,
	StartRunInput,
} from "./contract";
export type { Device, SessionInput } from "./device";
export {
	localDevice,
	serveWork,
	type WorkCall,
	type WorkRelay,
	type WorkReply,
	type WorkRequest,
	workReplySchema,
	workRequestSchema,
} from "./device";
export {
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
	type DeviceDocument,
	documentRows,
	HARNESS_BIN,
	isHostAddress,
	isLoopbackHost,
	openDeviceDocument,
	type ProfileStore,
	type ProfileView,
	refreshDeviceFacts,
	type SecretSource,
	type SecretView,
	type SettingField,
	type SettingKey,
	type Settings,
	type SettingsStore,
	secretNameSchema,
	secretStore,
	selfDevice,
	settingsPatchSchema,
	settingsSchema,
} from "./device-config";
export type { FlowRef, FlowUse } from "./flows";
export type { TranscriptEntry } from "./log";
export type { DeviceRegistry, PairedDevice } from "./peers";
export {
	type ArchiveRef,
	applyRunCommand,
	archiveRefSchema,
	COMMAND_PERMISSION,
	createHostLinks,
	createOfferSlots,
	type DeviceKeyStore,
	type DeviceOffer,
	deviceKeyStore,
	deviceOffers,
	type FollowWant,
	ForeignRowsError,
	feedStepSchema,
	followWantSchema,
	type HostLink,
	type HostLinks,
	type HostRole,
	inForce,
	isEmpty,
	type KeyStoreKind,
	type ListedSpace,
	MissingProjectError,
	mergeCursors,
	type OfferCaps,
	type OfferSlots,
	offerCapsSchema,
	offeredCallRefusal,
	offeredSession,
	personOnHost,
	type RunCommand,
	type RunCommandInput,
	type RunRows,
	removeDeviceOffer,
	runRowsSchema,
	SECOND_HOME,
	type SyncCursors,
	setDeviceOffer,
	slotKey,
	syncCursorsSchema,
	transcriptEntrySchema,
	withoutPrivatePaths,
} from "./peers";
export type { Project } from "./projects";
export {
	type Branches,
	checkProjectFolder,
	clonePathOf,
	createSpaceDocuments,
	type GitInstall,
	memberRole,
	type ProjectReadiness,
	type SpaceDocuments,
	setUpGit,
	spaceDocumentName,
	spaceIdOf,
	systemGitInstaller,
	worktreeLocation,
} from "./projects";
export type { OpenGate, RunDetail, RunStreamItem, RunSummary } from "./read";
export { exportRun, openRunBundle, type RunBundleSummary } from "./read";
export { createEngine } from "./run";
export type { ScheduleList } from "./schedules";
