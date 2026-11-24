import { describe, expect, test } from "bun:test";
import { inMemorySettingsPorts } from "../adapters/out/in-memory-neighbours";
import { defaultSettings } from "../domain/notification-settings";
import { findSettings } from "./find-settings";

/** The use case findSettings, on in-memory adapters. */

describe("findSettings", () => {
	test("a Person without settings has the defaults, in the zone of this computer", async () => {
		const ports = { ...inMemorySettingsPorts(), timeZone: "Europe/Amsterdam" };
		expect(await findSettings(ports)({ personId: "ada" })).toEqual(
			defaultSettings("Europe/Amsterdam"),
		);
	});

	test("a Person with settings has their own", async () => {
		const ports = inMemorySettingsPorts();
		const own = { ...defaultSettings("UTC"), holdMinutes: 10 };
		await ports.settingsStore.put("ada", own);
		expect(await findSettings(ports)({ personId: "ada" })).toEqual(own);
		expect(await findSettings(ports)({ personId: "bob" })).toEqual(
			defaultSettings("UTC"),
		);
	});
});
