/**
 * The package entry `@nightshift/engine/device-config`: what `devices`, the
 * API and the daemon use of this computer's Device document (settings,
 * connections and secrets, CLI tools, Agent Profiles, the Device copies).
 * The barrel (`index.ts`) also serves the engine's other verticals. This
 * entry carries only the names another workspace imports.
 */

export type { DeviceDocument } from "../documents";
export {
	deviceDocumentName,
	openDeviceDocument,
	refreshDeviceFacts,
} from "../documents";
export type { KeyStoreKind } from "../key-store";
export { valueStore } from "../key-store";
export type { CliTool, CliToolStore } from "./cli-tools";
export { cliToolGitSchema, cliToolInputSchema } from "./cli-tools";
export { openConfigStores } from "./config-stores";
export type {
	Connection,
	ConnectionStore,
	PersonalSecrets,
	ProjectSecretName,
	ProjectSecrets,
	SecretScope,
	SecretSource,
	SecretView,
} from "./connections";
export {
	connectionInputSchema,
	secretStore,
	unreachableNote,
} from "./connections";
export {
	createDeviceCopies,
	type DeviceCopies,
	type DeviceCopy,
} from "./device-copies";
export {
	addHarness,
	customAgentOf,
	removeCliTool,
	removeConnection,
	removeHarness,
	saveConnection,
	saveCustomAgent,
	saveProfile,
} from "./edits";
export {
	type FoundProgram,
	foundPrograms,
	type SetUpProgram,
	setUpProgram,
} from "./found-programs";
export type { ProfileStore, ProfileView } from "./profiles";
export { profileChoice } from "./profiles";
export type { ProjectRef, SecretUse, StepRun } from "./secret-scopes";
export type {
	SettingField,
	SettingKey,
	SettingsStore,
	TelemetryProtocol,
} from "./settings";
export {
	HARNESS_BIN,
	isHostAddress,
	isLoopbackHost,
	reachesPrivateNetwork,
	settingsPatchSchema,
	settingsSchema,
	withEffectiveDecider,
} from "./settings";
