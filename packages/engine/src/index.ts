/**
 * The public surface of the engine: what the API, the server and their
 * tests import. A type is also here when the API's router type names it,
 * because the router declaration must be able to name it. Remove a name
 * that nothing outside the engine imports.
 */
export {
	type CliTool,
	type CliToolStore,
	cliToolInputSchema,
	createCliToolStore,
} from "./cli-tools";
export {
	type Connection,
	type ConnectionStore,
	connectionInputSchema,
	createConnectionStore,
	type SecretSource,
	type SecretView,
	secretNameSchema,
	secretStore,
} from "./connections";
export {
	type DeviceDocument,
	documentRows,
	openDeviceDocument,
	refreshDeviceFacts,
} from "./device/document";
export {
	createHostLinks,
	type DeviceKeyStore,
	deviceKeyStore,
	type HostLink,
	type HostLinks,
	type HostRole,
	type KeyStoreKind,
	SECOND_HOME,
} from "./device/host-links";
export { localDevice } from "./device/local";
export type { DeviceRegistry, PairedDevice } from "./device/registry";
export {
	serveWork,
	type WorkCall,
	type WorkRelay,
	type WorkReply,
	type WorkRequest,
	workReplySchema,
	workRequestSchema,
} from "./device/remote";
export type { Device, SessionInput } from "./device/types";
export { createEngine } from "./engine";
export { type ArchiveRef, archiveRefSchema } from "./exchange/archive";
export {
	applyRunCommand,
	COMMAND_PERMISSION,
	type RunCommand,
	type RunCommandInput,
} from "./exchange/commands";
export {
	type FeedStep,
	type FollowWant,
	feedStepSchema,
	transcriptEntrySchema,
} from "./exchange/feeds";
export { type ListedSpace, personOnHost } from "./exchange/host-spaces";
export {
	ForeignRowsError,
	isEmpty,
	MissingProjectError,
	mergeCursors,
	type RunRows,
	runRowsSchema,
	type SyncCursors,
	syncCursorsSchema,
	withoutPrivatePaths,
} from "./exchange/rows";
export { chooseFolder } from "./folder-picker";
export {
	acquireLease,
	LEASE_HEARTBEAT_MS,
	type Lease,
	LeaseHeldError,
	pidAlive,
} from "./lease";
export {
	createOfferSlots,
	type DeviceOffer,
	deviceOffers,
	inForce,
	type OfferCaps,
	type OfferSlots,
	offerCapsSchema,
	offeredCallRefusal,
	offeredSession,
	removeDeviceOffer,
	setDeviceOffer,
	slotKey,
} from "./offers";
export {
	createProfileStore,
	type ProfileStore,
	type ProfileView,
} from "./profiles";
export {
	checkProjectFolder,
	type GitInstall,
	type ProjectReadiness,
	setUpGit,
	systemGitInstaller,
} from "./project-setup";
export { clonePathOf } from "./projects";
export { exportRun, openRunBundle, type RunBundleSummary } from "./run-bundle";
export { selfDevice } from "./self-device";
export {
	createSettingsStore,
	HARNESS_BIN,
	isHostAddress,
	isLoopbackHost,
	type SettingField,
	type SettingKey,
	type Settings,
	type SettingsStore,
	settingsPatchSchema,
} from "./settings";
export {
	createSpaceDocuments,
	memberRole,
	type SpaceDocuments,
	spaceDocumentName,
	spaceIdOf,
} from "./space/document";
export type {
	Engine,
	OpenGate,
	OwnDevice,
	Placement,
	Project,
	Relay,
	RunDetail,
	RunStreamItem,
	RunSummary,
	ScheduleList,
	SpaceEngine,
	StartRunInput,
	TranscriptEntry,
} from "./types";
export { type Branches, worktreeLocation } from "./worktrees";
