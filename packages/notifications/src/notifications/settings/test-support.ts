import { migratedDb } from "@nightshift/db/testing";
import { drizzleSettingsStore } from "./adapters/out/drizzle-settings-store";

/** Every port of settings, over a database in memory: where each use-case test starts. */
export async function settingsPorts() {
	return {
		settingsStore: drizzleSettingsStore({
			db: await migratedDb(),
			timeZone: "UTC",
		}),
		timeZone: "UTC",
	};
}
