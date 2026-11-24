import { describe, expect, test } from "bun:test";
import { notificationSettings } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { eq } from "drizzle-orm";
import { drizzleSettingsStore } from "./drizzle-settings-store";
import { inMemorySettingsStore } from "./in-memory-settings-store";
import { settingsStoreContract } from "./settings-store.contract";

/**
 * The contract of `SettingsStore`, on both adapters. The real adapter's
 * side runs on libsql in memory. Then the rows only the real adapter can
 * hold: from an older version, or not readable.
 */

async function memoryDb() {
	const db = await migratedDb();
	return db;
}

settingsStoreContract("in memory", async () => ({
	settingsStore: inMemorySettingsStore(),
	close: async () => {},
}));

settingsStoreContract("over drizzle", async () => ({
	settingsStore: drizzleSettingsStore({
		db: await memoryDb(),
		timeZone: "UTC",
	}),
	close: async () => {},
}));

describe("SettingsStore over drizzle: the rows it reads", () => {
	test("a row from before the urgencies, or one it cannot read, pushes only for now", async () => {
		const db = await memoryDb();
		const store = drizzleSettingsStore({ db, timeZone: "UTC" });
		await db.insert(notificationSettings).values({ personId: "ada" });
		expect((await store.get("ada"))?.pushUrgencies).toEqual(["now"]);

		await db
			.update(notificationSettings)
			.set({ pushUrgencies: "not json" })
			.where(eq(notificationSettings.personId, "ada"));
		expect((await store.get("ada"))?.pushUrgencies).toEqual(["now"]);

		await db
			.update(notificationSettings)
			.set({ pushUrgencies: '["soon"]' })
			.where(eq(notificationSettings.personId, "ada"));
		expect((await store.get("ada"))?.pushUrgencies).toEqual(["now"]);
	});

	test("screens it cannot read take their defaults, and a zone it cannot read is the fallback", async () => {
		const db = await memoryDb();
		const store = drizzleSettingsStore({ db, timeZone: "Europe/Amsterdam" });
		await db.insert(notificationSettings).values({
			personId: "ada",
			screens: "not json",
			timeZone: "Mars/Olympus",
		});
		const read = await store.get("ada");
		expect(read?.screens).toEqual({ web: true, expo: true, desktop: true });
		expect(read?.timeZone).toBe("Europe/Amsterdam");

		await db
			.update(notificationSettings)
			.set({ screens: '{"expo":false}' })
			.where(eq(notificationSettings.personId, "ada"));
		expect((await store.get("ada"))?.screens).toEqual({
			web: true,
			expo: false,
			desktop: true,
		});
	});
});
