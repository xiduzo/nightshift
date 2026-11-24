import type { ComputerAccess } from "../../../access";
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
	computerAccess: Pick<ComputerAccess, "openComputer">;
	saved: Pick<SavedSettings, "read" | "write">;
	ground: SettingsGround;
};

/**
 * Saves a change of this computer's settings in one write: a value saves
 * it, null forgets it. It refuses a patch that does not parse and a first
 * usage-limit wait longer than the longest one, and then writes nothing.
 * It answers the settings as they are after the save. Only the owner of
 * this computer may save (`computerAccess.openComputer`).
 */
export const saveSettings =
	(ports: SaveSettingsPorts) =>
	async (actor: Actor, patch: SettingsPatch): Promise<SettingsView> => {
		ports.computerAccess.openComputer(actor);
		const { saved, ground } = ports;
		await saved.write(planSettingsSave(patch, saved.read(), ground));
		return settingsView(saved.read(), ground);
	};
