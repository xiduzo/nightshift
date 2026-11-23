/** This computer's configuration in its Device document: settings, connections and secrets, CLI tools, Agent Profiles, the edits that touch more than one of them, and the copies of the owner's other Devices. `wireSettings` binds them. */

export {
	type CliTool,
	type CliToolStore,
	cliToolGitSchema,
	cliToolInputSchema,
	cliToolsInstruction,
	programOf,
} from "./cli-tools";
export {
	type Connection,
	type ConnectionStore,
	connectionInputSchema,
	unreachableNote,
} from "./connections";
export { type DeviceCopies, type DeviceCopy, wireCopies } from "./copies";
export { agentProfileOn, customAgentOf, saveProfile } from "./edits";
export { type ProfileStore, type ProfileView, profileChoice } from "./profiles";
export {
	defaultRunSettings,
	effectiveDecider,
	HARNESS_BIN,
	isHostAddress,
	isLoopbackHost,
	type RunSettings,
	reachesPrivateNetwork,
	type SettingField,
	type SettingKey,
	type SettingsStore,
	settingsPatchSchema,
	settingsSchema,
	type TelemetryProtocol,
	withEffectiveDecider,
} from "./settings";
export {
	type ConfigStores,
	type DeviceConfig,
	type DeviceConfigUseCases,
	wireSettings,
} from "./wire";
