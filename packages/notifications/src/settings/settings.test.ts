import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@nightshift/db";

import { testDatabase } from "../testing/database";
import { createSettingsStore, defaultSettings, inQuietHours } from "./settings";

let db: Database;
let cleanup: () => void;
beforeEach(async () => {
	({ db, cleanup } = await testDatabase());
});
afterEach(() => cleanup());

const at = (hour: number, minute = 0) => Date.UTC(2026, 9, 21, hour, minute);

describe("quiet hours", () => {
	const night = {
		quietHours: { start: "22:00", end: "07:00" },
		timeZone: "UTC",
	};

	test("a window over midnight holds from its start to its end", () => {
		expect(inQuietHours(night, at(21, 59))).toBe(false);
		expect(inQuietHours(night, at(22, 0))).toBe(true);
		expect(inQuietHours(night, at(3, 0))).toBe(true);
		expect(inQuietHours(night, at(6, 59))).toBe(true);
		expect(inQuietHours(night, at(7, 0))).toBe(false);
	});

	test("a window within one day", () => {
		const lunch = { ...night, quietHours: { start: "12:00", end: "13:30" } };
		expect(inQuietHours(lunch, at(11, 59))).toBe(false);
		expect(inQuietHours(lunch, at(13, 0))).toBe(true);
		expect(inQuietHours(lunch, at(13, 30))).toBe(false);
	});

	test("no window, or one that ends when it starts, is never quiet", () => {
		expect(inQuietHours({ ...night, quietHours: null }, at(23))).toBe(false);
		expect(
			inQuietHours(
				{ ...night, quietHours: { start: "08:00", end: "08:00" } },
				at(8),
			),
		).toBe(false);
	});

	test("count in the person's time zone", () => {
		// 21:00 UTC is 23:00 in Amsterdam in October (summer time).
		const amsterdam = { ...night, timeZone: "Europe/Amsterdam" };
		expect(inQuietHours(amsterdam, at(21))).toBe(true);
		expect(inQuietHours(night, at(21))).toBe(false);
	});
});

describe("the settings store", () => {
	test("a Person without settings has the defaults", async () => {
		const store = createSettingsStore(db, { timeZone: "Europe/Amsterdam" });
		expect(await store.get("ada")).toEqual(defaultSettings("Europe/Amsterdam"));
		expect(defaultSettings("UTC")).toMatchObject({
			events: { gateOpened: true, runFinished: true, runFailed: true },
			quietHours: null,
			screens: { web: true, expo: true, desktop: true },
			holdMinutes: 3,
		});
	});

	test("a change keeps what it does not name", async () => {
		const store = createSettingsStore(db, { timeZone: "UTC" });
		await store.save("ada", { events: { runFinished: false } });
		const saved = await store.save("ada", {
			quietHours: { start: "22:30", end: "06:45" },
			screens: { expo: false },
		});
		expect(saved).toMatchObject({
			events: { gateOpened: true, runFinished: false, runFailed: true },
			quietHours: { start: "22:30", end: "06:45" },
			screens: { web: true, expo: false, desktop: true },
		});
		expect(await store.get("ada")).toEqual(saved);
		expect(await store.get("bob")).toEqual(defaultSettings("UTC"));
		expect((await store.save("ada", { quietHours: null })).quietHours).toBe(
			null,
		);
	});

	test("refuses a time or a time zone it cannot read", async () => {
		const store = createSettingsStore(db, { timeZone: "UTC" });
		await expect(
			store.save("ada", { quietHours: { start: "25:00", end: "07:00" } }),
		).rejects.toThrow("Use a time like 22:00.");
		await expect(
			store.save("ada", { timeZone: "Mars/Olympus" }),
		).rejects.toThrow("Use a time zone like Europe/Amsterdam.");
	});

	test("the copy of a computer's choices goes in once, never over a Person's own", async () => {
		const store = createSettingsStore(db, { timeZone: "UTC" });
		await store.seed("ada", { runFinished: false });
		expect((await store.get("ada")).events.runFinished).toBe(false);

		await store.save("ada", { events: { runFinished: true } });
		await store.seed("ada", { runFinished: false, gateOpened: false });
		expect((await store.get("ada")).events).toEqual({
			gateOpened: true,
			runFinished: true,
			runFailed: true,
		});
	});

	test("a save of the computer's switches also changes the Person's events", async () => {
		const store = createSettingsStore(db, { timeZone: "UTC" });
		const switches = {
			notifyGateOpened: true,
			notifyRunFinished: false,
			notifyRunFailed: true,
		};
		await store.save("ada", { holdMinutes: 10 });

		await store.adoptComputerSwitches("ada", {}, switches);
		expect((await store.get("ada")).events.runFinished).toBe(true);

		await store.adoptComputerSwitches(
			"ada",
			{ notifyRunFinished: false },
			switches,
		);
		const after = await store.get("ada");
		expect(after.events).toEqual({
			gateOpened: true,
			runFinished: false,
			runFailed: true,
		});
		expect(after.holdMinutes).toBe(10);
	});
});
