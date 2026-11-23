/** This computer's settings: saved in its Device document, else read from the environment, else their default (`wireSettings`). */

export {
	effectiveDecider,
	withEffectiveDecider,
} from "./domain/effective-decider";
export {
	isHostAddress,
	isLoopbackHost,
	reachesPrivateNetwork,
} from "./domain/host-address";
export { defaultRunSettings, type RunSettings } from "./domain/run-settings";
export {
	HARNESS_BIN,
	type SettingKey,
	settingsPatchSchema,
	settingsSchema,
	type TelemetryProtocol,
} from "./domain/setting-defs";
export type { SettingField } from "./domain/setting-fields";
export { type SettingsStore, type WiredSettings, wireSettings } from "./wire";
