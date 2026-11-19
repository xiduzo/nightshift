import { describe, expect, test } from "bun:test";
import { inMemorySettingsPorts } from "../adapters/out/in-memory-neighbours";
import { defaultSettings } from "../domain/notification-settings";
import { seedSettings } from "./seed-settings";

/** The use case seedSettings, on in-memory adapters. */

const switches = {
	notifyGateOpened: true,
	notifyRunFinished: false,
	notifyRunFailed: true,
};

describe("seedSettings", () => {
	test("the copy of a computer's choices goes in once, never over a Person's own", async () => {
		const ports = inMemorySettingsPorts();
		await seedSettings(ports)({ personId: "ada", switches });
		expect((await ports.settingsStore.get("ada"))?.events).toEqual({
			gateOpened: true,
			runFinished: false,
			runFailed: true,
			deviceWait: true,
		});

		const own = defaultSettings("UTC");
		await ports.settingsStore.put("bob", own);
		await seedSettings(ports)({ personId: "bob", switches });
		expect(await ports.settingsStore.get("bob")).toEqual(own);
		expect(ports.settingsStore.writes.map((write) => write.kind)).toEqual([
			"putIfAbsent",
			"put",
			"putIfAbsent",
		]);
	});
});
