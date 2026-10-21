/** This computer's configuration in its Device document: settings, connections and secrets, CLI tools, Agent Profiles, MCP servers. */

export type { CliTool, CliToolGuide, CliToolStore } from "./cli-tools";
export {
	cliToolInputSchema,
	cliToolsInstruction,
	createCliToolStore,
} from "./cli-tools";
export type {
	Connection,
	ConnectionStore,
	SecretSource,
	SecretView,
} from "./connections";
export {
	connectionInputSchema,
	createConnectionStore,
	secretNameSchema,
	secretStore,
} from "./connections";
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
export type { KeyStoreKind } from "./keychain";
export { valueStore } from "./keychain";
export type { McpExpansion } from "./mcp";
export { expandMcpServers } from "./mcp";
export type { ProfileStore, ProfileView } from "./profiles";
export { createProfileStore } from "./profiles";
export type {
	RunSettings,
	SettingField,
	SettingKey,
	Settings,
	SettingsStore,
} from "./settings";
export {
	createSettingsStore,
	defaultRunSettings,
	HARNESS_BIN,
	isHostAddress,
	isLoopbackHost,
	settingsPatchSchema,
	settingsSchema,
} from "./settings";
export type { PersistedDocument } from "./ydoc";
export { openPersistedDocument } from "./ydoc";
