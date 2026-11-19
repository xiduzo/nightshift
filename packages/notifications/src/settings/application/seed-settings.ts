import {
	applyPatch,
	type ComputerSwitches,
	defaultSettings,
	eventsOfSwitches,
} from "../domain/notification-settings";
import type { SettingsStore } from "./ports";

export type SeedSettingsPorts = {
	settingsStore: Pick<SettingsStore, "putIfAbsent">;
	/** The time zone of a Person who saved no settings. */
	timeZone: string;
};

/** The Person, and the switches this computer kept for them. */
export type SeedSettings = { personId: string; switches: ComputerSwitches };

/**
 * Gives a Person who has no settings yet the choices of this computer's
 * switches, once: the copy of the settings a computer kept before they
 * moved to the Person. A Person with settings keeps them. Night Shift
 * asks, when the daemon starts.
 */
export const seedSettings =
	(ports: SeedSettingsPorts) =>
	async (request: SeedSettings): Promise<void> => {
		const settings = applyPatch(defaultSettings(ports.timeZone), {
			events: eventsOfSwitches(request.switches),
		});
		await ports.settingsStore.putIfAbsent(request.personId, settings);
	};
