import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SettingsStore } from "../../application/ports";
import {
	defaultSettings,
	type NotificationSettings,
} from "../../domain/notification-settings";

/** One adapter of `SettingsStore` to test. */
export type SettingsStoreUnderTest = {
	settingsStore: SettingsStore;
	close(): Promise<void>;
};

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

/**
 * What every adapter of `SettingsStore` does.
 * `settings-store.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function settingsStoreContract(
	name: string,
	make: () => Promise<SettingsStoreUnderTest>,
): void {
	describe(`SettingsStore contract: ${name}`, () => {
		let under: SettingsStoreUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
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

		test("putIfAbsent keeps a Person's own settings", async () => {
			await under.settingsStore.putIfAbsent("ada", SAVED);
			expect(await under.settingsStore.get("ada")).toEqual(SAVED);
			await under.settingsStore.putIfAbsent("ada", defaultSettings("UTC"));
			expect(await under.settingsStore.get("ada")).toEqual(SAVED);
		});
	});
}
