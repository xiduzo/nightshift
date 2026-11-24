import { NIGHT_SHIFT } from "../../../../contract";
import { saveSettings } from "../../application/save-settings";
import type { SettingKey, SettingsPatch } from "../../domain/setting-defs";
import { currentSettings, settingsView } from "../../domain/setting-fields";
import type { SettingsStore } from "../../wire";
import { inMemorySavedSettings } from "./in-memory-saved-settings";

/**
 * The settings over in-memory adapters: the real use case behind the store,
 * with the values a test saved before and no environment. Test code:
 * production code never imports this file.
 */
export function inMemorySettings(
	initial: Partial<Record<SettingKey, unknown>> = {},
) {
	const saved = inMemorySavedSettings(
		Object.entries(initial) as [SettingKey, unknown][],
	);
	const ground = { env: {}, embeddingModel: "embedder" };
	const save = saveSettings({ saved, ground });
	const bound = {
		view: () => settingsView(saved.read(), ground),
		current: () => currentSettings(saved.read(), ground),
		save: (patch: SettingsPatch) => save(NIGHT_SHIFT, patch),
	} satisfies Partial<SettingsStore>;
	return { ...bound, saved };
}
