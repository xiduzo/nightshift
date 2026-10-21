import { describe, expect, test } from "bun:test";

import { applySettingsPatch, type NotificationSettings } from "./queries";

const saved: NotificationSettings = {
	events: { gateOpened: true, runFinished: true, runFailed: true },
	quietHours: { start: "22:00", end: "07:00" },
	timeZone: "Europe/Amsterdam",
	screens: { web: true, expo: true, desktop: true },
	holdMinutes: 3,
};

describe("applySettingsPatch", () => {
	test("merges one event and keeps the others", () => {
		const next = applySettingsPatch(saved, { events: { runFinished: false } });
		expect(next.events).toEqual({
			gateOpened: true,
			runFinished: false,
			runFailed: true,
		});
		expect(next.quietHours).toEqual(saved.quietHours);
	});

	test("null turns quiet hours off; leaving them out keeps them", () => {
		expect(applySettingsPatch(saved, { quietHours: null }).quietHours).toBe(
			null,
		);
		expect(applySettingsPatch(saved, { holdMinutes: 0 })).toEqual({
			...saved,
			holdMinutes: 0,
		});
	});

	test("replaces the time zone and merges a screen", () => {
		const next = applySettingsPatch(saved, {
			timeZone: "UTC",
			screens: { expo: false },
		});
		expect(next.timeZone).toBe("UTC");
		expect(next.screens).toEqual({ web: true, expo: false, desktop: true });
	});
});
