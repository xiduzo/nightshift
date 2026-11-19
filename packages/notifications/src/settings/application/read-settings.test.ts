import { describe, expect, test } from "bun:test";
import type { Actor } from "@nightshift/engine";
import { inMemorySettingsPorts } from "../adapters/out/in-memory-neighbours";
import { defaultSettings } from "../domain/notification-settings";
import { readSettings } from "./read-settings";

/** The use case readSettings, on in-memory adapters. */

const ADA: Actor = { personId: "ada", door: "session" };

describe("readSettings", () => {
	test("a Person without settings has the defaults, in the zone of this computer", async () => {
		const ports = { ...inMemorySettingsPorts(), timeZone: "Europe/Amsterdam" };
		expect(await readSettings(ports)(ADA, { personId: "ada" })).toEqual(
			defaultSettings("Europe/Amsterdam"),
		);
	});

	test("a Person with settings has their own", async () => {
		const ports = inMemorySettingsPorts();
		const own = { ...defaultSettings("UTC"), holdMinutes: 10 };
		await ports.settingsStore.put("ada", own);
		expect(
			await readSettings(ports)({ nightShift: true }, { personId: "ada" }),
		).toEqual(own);
		expect(await readSettings(ports)(ADA, { personId: "bob" })).toEqual(
			defaultSettings("UTC"),
		);
	});
});
