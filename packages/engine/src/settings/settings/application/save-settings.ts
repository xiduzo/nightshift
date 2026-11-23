import type { Actor } from "../../../contract";
import type { SettingsPatch } from "../domain/setting-defs";
import {
	type SettingsGround,
	type SettingsView,
	settingsView,
} from "../domain/setting-fields";
import { planSettingsSave } from "../domain/settings-patch";
import type { SavedSettings } from "./ports";

export type SaveSettingsPorts = {
	saved: Pick<SavedSettings, "read" | "write">;
	ground: SettingsGround;
};

/**
 * Saves a change of this computer's settings in one write: a value saves
 * it, null forgets it. It refuses a patch that does not parse and a first
 * usage-limit wait longer than the longest one, and then writes nothing.
 * It answers the settings as they are after the save. The owner of this
 * computer may save: its door checks that (`ownerProcedure`).
 */
export const saveSettings =
	(ports: SaveSettingsPorts) =>
	async (_actor: Actor, patch: SettingsPatch): Promise<SettingsView> => {
		const { saved, ground } = ports;
		await saved.write(planSettingsSave(patch, saved.read(), ground));
		return settingsView(saved.read(), ground);
	};
