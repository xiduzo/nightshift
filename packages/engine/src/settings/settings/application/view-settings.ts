import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import {
	type SettingsGround,
	type SettingsView,
	settingsView,
} from "../domain/setting-fields";
import type { SavedSettings } from "./ports";

export type ViewSettingsPorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	saved: Pick<SavedSettings, "read">;
	ground: SettingsGround;
};

/**
 * This computer's settings: each value, and where it comes from (saved,
 * the environment or the default), with the lock of a switch the
 * environment holds off. Only the owner of this computer may look
 * (`computerAccess.openComputer`).
 */
export const viewSettings =
	(ports: ViewSettingsPorts) =>
	(actor: Actor): SettingsView => {
		ports.computerAccess.openComputer(actor);
		return settingsView(ports.saved.read(), ports.ground);
	};
