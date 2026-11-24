import type { Database } from "@nightshift/db";
import { localZone } from "@nightshift/time";
import { drizzleSettingsStore } from "./adapters/out/drizzle-settings-store";
import { findSettings } from "./application/find-settings";
import { readSettings } from "./application/read-settings";
import { saveSettings } from "./application/save-settings";

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
	/** A Person's settings, or the defaults, for Night Shift to decide whom to tell. */
	find: ReturnType<typeof findSettings>;
	/** The settings of the Person who asks, or the defaults. */
	read: ReturnType<typeof readSettings>;
	/** Saves a change of the settings of the Person who asks, and returns them all. */
	save: ReturnType<typeof saveSettings>;
};

export function wireSettings(deps: SettingsDeps): Settings {
	const timeZone = deps.timeZone ?? localZone();
	const ports = {
		timeZone,
		settingsStore: drizzleSettingsStore({ db: deps.db, timeZone }),
	};
	const find = findSettings(ports);
	return {
		find,
		read: readSettings({ findSettings: find }),
		save: saveSettings(ports),
	};
}
