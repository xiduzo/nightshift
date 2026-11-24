import { describe, expect, test } from "bun:test";
import type { PersonActor } from "@nightshift/engine";
import { inMemorySettingsPorts } from "../adapters/out/in-memory-neighbours";
import { defaultSettings } from "../domain/notification-settings";
import { findSettings } from "./find-settings";
import { readSettings } from "./read-settings";

/** The use case readSettings, on in-memory adapters. */

const ADA: PersonActor = { personId: "ada", door: "session" };
const BOB: PersonActor = { personId: "bob", door: "session" };

describe("readSettings", () => {
	test("each Person reads their own", async () => {
		const ports = inMemorySettingsPorts();
		const own = { ...defaultSettings("UTC"), holdMinutes: 10 };
		await ports.settingsStore.put("ada", own);
		const read = readSettings({ findSettings: findSettings(ports) });
		expect(await read(ADA)).toEqual(own);
		expect(await read(BOB)).toEqual(defaultSettings("UTC"));
	});
});
