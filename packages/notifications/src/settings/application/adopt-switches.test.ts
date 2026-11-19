import { describe, expect, test } from "bun:test";
import { inMemorySettingsPorts } from "../adapters/out/in-memory-neighbours";
import { defaultSettings } from "../domain/notification-settings";
import { adoptSwitches } from "./adopt-switches";

/** The use case adoptSwitches, on in-memory adapters. */

const switches = {
	notifyGateOpened: true,
	notifyRunFinished: false,
	notifyRunFailed: true,
};

describe("adoptSwitches", () => {
	test("a save of the computer's switches also changes the Person's events, and leaves the device wait alone", async () => {
		const ports = inMemorySettingsPorts();
		const own = {
			...defaultSettings("UTC"),
			holdMinutes: 10,
			events: { ...defaultSettings("UTC").events, deviceWait: false },
		};
		await ports.settingsStore.put("ada", own);

		await adoptSwitches(ports)({ personId: "ada", patch: {}, switches });
		expect(await ports.settingsStore.get("ada")).toEqual(own);
		expect(ports.settingsStore.writes).toHaveLength(1);

		await adoptSwitches(ports)({
			personId: "ada",
			patch: { notifyRunFinished: false },
			switches,
		});
		const after = await ports.settingsStore.get("ada");
		expect(after?.events).toEqual({
			gateOpened: true,
			runFinished: false,
			runFailed: true,
			deviceWait: false,
		});
		expect(after?.holdMinutes).toBe(10);
	});

	test("a Person without settings starts from the defaults", async () => {
		const ports = inMemorySettingsPorts();
		await adoptSwitches(ports)({
			personId: "ada",
			patch: { notifyGateOpened: true },
			switches,
		});
		expect(await ports.settingsStore.get("ada")).toEqual({
			...defaultSettings("UTC"),
			events: {
				gateOpened: true,
				runFinished: false,
				runFailed: true,
				deviceWait: true,
			},
		});
	});
});
