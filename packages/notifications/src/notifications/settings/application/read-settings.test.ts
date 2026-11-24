import { describe, expect, test } from "bun:test";
import type { PersonActor } from "@nightshift/engine";
import { defaultSettings } from "../domain/notification-settings";
import { settingsPorts } from "../test-support";
import { findSettings } from "./find-settings";
import { readSettings } from "./read-settings";

/** The use case readSettings, over a database in memory. */

const ADA: PersonActor = { personId: "ada", door: "session" };
const BOB: PersonActor = { personId: "bob", door: "session" };

describe("readSettings", () => {
	test("each Person reads their own", async () => {
		const ports = await settingsPorts();
		const own = { ...defaultSettings("UTC"), holdMinutes: 10 };
		await ports.settingsStore.put("ada", own);
		const read = readSettings({ findSettings: findSettings(ports) });
		expect(await read(ADA)).toEqual(own);
		expect(await read(BOB)).toEqual(defaultSettings("UTC"));
	});
});
