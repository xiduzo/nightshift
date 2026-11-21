/** This computer's configuration in its Device document: settings, connections and secrets, CLI tools, Agent Profiles, MCP servers. */

export type { SecretUse, StepRun } from "../contract";
export {
	type ProjectSecretName,
	type SecretList,
	type SecretView,
	takenOverSecrets,
	unreachableNote,
} from "../secrets";
export type { CliTool, CliToolStore } from "./cli-tools";
export { cliToolsInstruction, programOf } from "./cli-tools";
export type { ConfigStores } from "./config-stores";
export type { Connection, ConnectionStore, SecretEnv } from "./connections";
export {
	type DeviceCopy,
	lastKnownProfiles,
	storedDeviceCopy,
	storedDevices,
} from "./device-copies";
export { saveProfile } from "./edits";
export { agentProfileOn } from "./found-programs";
export type { ProfileStore, ProfileView } from "./profiles";
export type { RunSettings, SettingsStore } from "./settings";
export {
	defaultRunSettings,
	effectiveDecider,
	HARNESS_BIN,
	isLoopbackHost,
} from "./settings";
