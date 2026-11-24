import { beforeEach, describe, expect, test } from "bun:test";
import { notificationSettings } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { eq } from "drizzle-orm";
import {
	defaultSettings,
	type NotificationSettings,
} from "../../domain/notification-settings";
import { drizzleSettingsStore } from "./drizzle-settings-store";

const SAVED: NotificationSettings = {
	events: {
		gateOpened: true,
		runFinished: false,
		runFailed: true,
		deviceWait: false,
	},
	quietHours: { start: "22:30", end: "06:45" },
	timeZone: "Europe/Amsterdam",
	screens: { web: true, expo: false, desktop: true },
	holdMinutes: 10,
	pushUrgencies: ["now", "later"],
};

async function memoryDb() {
	const db = await migratedDb();
	return db;
}

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

const make = async () => ({
	settingsStore: drizzleSettingsStore({
		db: await memoryDb(),
		timeZone: "UTC",
	}),
});

describe("SettingsStore over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
	beforeEach(async () => {
		under = await make();
	});

	test("a Person who saved nothing has no settings", async () => {
		expect(await under.settingsStore.get("ada")).toBeNull();
	});

	test("gives back what was put, for that Person only", async () => {
		await under.settingsStore.put("ada", SAVED);
		expect(await under.settingsStore.get("ada")).toEqual(SAVED);
		expect(await under.settingsStore.get("bob")).toBeNull();
	});

	test("a put replaces what the Person had, also no quiet hours and no urgencies", async () => {
		await under.settingsStore.put("ada", SAVED);
		const next = {
			...defaultSettings("UTC"),
			quietHours: null,
			pushUrgencies: [],
		};
		await under.settingsStore.put("ada", next);
		expect(await under.settingsStore.get("ada")).toEqual(next);
	});
});
