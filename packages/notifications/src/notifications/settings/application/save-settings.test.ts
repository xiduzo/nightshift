import { describe, expect, test } from "bun:test";
import type { PersonActor } from "@nightshift/engine";
import type { NotificationSettingsPatch } from "../domain/notification-settings";
import { settingsPorts } from "../test-support";
import { findSettings } from "./find-settings";
import { saveSettings } from "./save-settings";

/** The use case saveSettings, over a database in memory. */

const ADA: PersonActor = { personId: "ada", door: "session" };
const BOB: PersonActor = { personId: "bob", door: "session" };

async function setUp() {
	const ports = await settingsPorts();
	return {
		ports,
		save: (patch: NotificationSettingsPatch) =>
			saveSettings(ports)(ADA, { patch }),
		read: (personId: string) => findSettings(ports)({ personId }),
	};
}

describe("saveSettings", () => {
	test("a change keeps what it does not name", async () => {
		const { save, read } = await setUp();
		await save({ events: { runFinished: false } });
		const saved = await save({
			quietHours: { start: "22:30", end: "06:45" },
			screens: { expo: false },
		});
		expect(saved).toMatchObject({
			events: { gateOpened: true, runFinished: false, runFailed: true },
			quietHours: { start: "22:30", end: "06:45" },
			screens: { web: true, expo: false, desktop: true },
		});
		expect(await read("ada")).toEqual(saved);
		expect((await save({ quietHours: null })).quietHours).toBe(null);
	});

	test("a Person changes only their own", async () => {
		const { ports, save, read } = await setUp();
		await save({ holdMinutes: 5 });
		await saveSettings(ports)(BOB, { patch: { holdMinutes: 20 } });
		expect((await read("ada")).holdMinutes).toBe(5);
		expect((await read("bob")).holdMinutes).toBe(20);
	});

	test("the urgencies that push: a round trip, once each, in order", async () => {
		const { save, read } = await setUp();
		const saved = await save({ pushUrgencies: ["later", "now", "later"] });
		expect(saved.pushUrgencies).toEqual(["now", "later"]);
		expect((await read("ada")).pushUrgencies).toEqual(["now", "later"]);
		expect((await save({ pushUrgencies: [] })).pushUrgencies).toEqual([]);
		await expect(save({ pushUrgencies: ["soon" as "now"] })).rejects.toThrow();
	});

	test("a save without the urgencies keeps them", async () => {
		const { save, read } = await setUp();
		await save({ pushUrgencies: ["now", "today"] });
		const saved = await save({ holdMinutes: 5 });
		expect(saved.pushUrgencies).toEqual(["now", "today"]);
		expect((await read("ada")).pushUrgencies).toEqual(["now", "today"]);
	});

	test("refuses a time or a time zone it cannot read, and saves nothing", async () => {
		const { ports, save } = await setUp();
		await expect(
			save({ quietHours: { start: "25:00", end: "07:00" } }),
		).rejects.toThrow("Use a time like 22:00.");
		await expect(save({ timeZone: "Mars/Olympus" })).rejects.toThrow(
			"Use a time zone like Europe/Amsterdam.",
		);
		expect(await ports.settingsStore.get("ada")).toBeNull();
	});
});
