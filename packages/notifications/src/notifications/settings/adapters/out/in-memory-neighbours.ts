import { inMemorySettingsStore } from "./in-memory-settings-store";

/**
 * `inMemorySettingsPorts`, which gives a use-case test every port of the
 * slice at once. Test code: production code never imports this file.
 */

/** Every port of settings in memory at once: where each use-case test starts. */
export function inMemorySettingsPorts() {
	return {
		settingsStore: inMemorySettingsStore(),
		timeZone: "UTC",
	};
}
