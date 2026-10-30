/**
 * The package entry `@nightshift/engine/device-config`: what `devices`, the
 * API and the daemon use of this computer's Device document (settings,
 * connections and secrets, CLI tools, Agent Profiles, the Device copies).
 * The barrel (`index.ts`) also serves the engine's other verticals. This
 * entry carries only the names another workspace imports.
 */

export type { CliTool, CliToolStore } from "./cli-tools";
export { cliToolGitSchema, cliToolInputSchema } from "./cli-tools";
export { openConfigStores } from "./config-stores";
export type {
	Connection,
	ConnectionStore,
	SecretSource,
	SecretView,
} from "./connections";
export { connectionInputSchema, secretStore } from "./connections";
export {
	createDeviceCopies,
	type DeviceCopies,
	type DeviceCopy,
} from "./device-copies";
export type { DeviceDocument } from "./device-document";
export {
	deviceDocumentName,
	documentRows,
	openDeviceDocument,
	refreshDeviceFacts,
} from "./device-document";
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
export type { KeyStoreKind } from "./keychain";
export { valueStore } from "./keychain";
export type { ProfileStore, ProfileView } from "./profiles";
export { profileChoice } from "./profiles";
export type { SettingField, SettingKey, SettingsStore } from "./settings";
export {
	HARNESS_BIN,
	isHostAddress,
	isLoopbackHost,
	settingsPatchSchema,
	settingsSchema,
} from "./settings";
