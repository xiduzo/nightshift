import type { Database } from "@nightshift/db";
import { localZone } from "@nightshift/time";
import { drizzleSettingsStore } from "./adapters/out/drizzle-settings-store";
import { adoptSwitches } from "./application/adopt-switches";
import { readSettings } from "./application/read-settings";
import { saveSettings } from "./application/save-settings";
import { seedSettings } from "./application/seed-settings";

/**
 * The wiring of settings: the one place that builds its real adapters
 * and binds each use case to its ports.
 */

/** What the package gives settings: what the real adapters stand on. */
export type SettingsDeps = {
	db: Database;
	/** The time zone of a Person without settings. Default: this computer's. */
	timeZone?: string;
};

/** The use cases of settings, bound to their ports. */
export type Settings = {
	/** A Person's settings, or the defaults. */
	read: ReturnType<typeof readSettings>;
	/** Saves a change of a Person's settings and returns them all. */
	save: ReturnType<typeof saveSettings>;
	/** The one-time copy of the switches a computer kept, for a Person without settings. */
	seed: ReturnType<typeof seedSettings>;
	/** After a save of the computer's settings: the Person's events take its switches. */
	adoptSwitches: ReturnType<typeof adoptSwitches>;
};

export function wireSettings(deps: SettingsDeps): Settings {
	const timeZone = deps.timeZone ?? localZone();
	const ports = {
		timeZone,
		settingsStore: drizzleSettingsStore({ db: deps.db, timeZone }),
	};
	return {
		read: readSettings(ports),
		save: saveSettings(ports),
		seed: seedSettings(ports),
		adoptSwitches: adoptSwitches(ports),
	};
}
