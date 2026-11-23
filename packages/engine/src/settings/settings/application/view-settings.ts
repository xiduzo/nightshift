import type { Actor } from "../../../contract";
import {
	type SettingsGround,
	type SettingsView,
	settingsView,
} from "../domain/setting-fields";
import type { SavedSettings } from "./ports";

export type ViewSettingsPorts = {
	saved: Pick<SavedSettings, "read">;
	ground: SettingsGround;
};

/**
 * This computer's settings: each value, and where it comes from (saved,
 * the environment or the default), with the lock of a switch the
 * environment holds off. The owner of this computer may look: its door
 * checks that (`ownerProcedure`), so the actor is not read here.
 */
export const viewSettings =
	(ports: ViewSettingsPorts) =>
	(_actor: Actor): SettingsView =>
		settingsView(ports.saved.read(), ports.ground);
