/** This computer's configuration in its Device document: settings, connections and secrets, CLI tools, Agent Profiles, MCP servers. */

export type { CliTool, CliToolGuide, CliToolStore } from "./cli-tools";
export { cliToolsInstruction, programOf } from "./cli-tools";
export type {
	Connection,
	ConnectionStore,
	SecretEnv,
	SecretView,
} from "./connections";
export {
	type DeviceCopy,
	lastKnownProfiles,
	storedDeviceCopy,
	storedDevices,
} from "./device-copies";
export type { McpExpansion } from "./mcp";
export type { ProfileStore, ProfileView } from "./profiles";

export type { RunSettings } from "./settings";
export { defaultRunSettings } from "./settings";
export type { PersistedDocument } from "./ydoc";
export { openPersistedDocument } from "./ydoc";
