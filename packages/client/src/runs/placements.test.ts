import { describe, expect, test } from "bun:test";

import { defaultPlacement, placementChoices } from "./placements";

const host = { deviceId: "host", name: "Studio", thisDevice: true };
const laptop = { deviceId: "laptop", name: "Laptop", thisDevice: false };
const offered = {
	deviceId: "kim",
	name: "Kim's Mac",
	thisDevice: false,
	offers: ["claude"],
};
const device = (
	deviceId: string,
	online: boolean,
	hasClone = true,
	thisDevice = false,
) => ({ deviceId, name: deviceId, thisDevice, online, hasClone });

describe("where a run can go", () => {
	test("the online Devices first, then your offline ones with the project", () => {
		const choices = placementChoices(
			[host, offered],
			[
				device("host", true, true, true),
				device("laptop", false),
				device("old-pc", false, false),
			],
		);
		expect(choices.map((c) => [c.deviceId, c.online])).toEqual([
			["host", true],
			["kim", true],
			["laptop", false],
		]);
		expect(choices[1]?.offers).toEqual(["claude"]);
		expect("offers" in (choices[0] ?? {})).toBe(false);
	});

	test("without the Devices list, only the online ones", () => {
		expect(placementChoices([laptop]).map((c) => c.deviceId)).toEqual([
			"laptop",
		]);
	});

	test("goes where the person chose, else this computer, else the first", () => {
		const choices = placementChoices([laptop, host], [device("pc", false)]);
		expect(defaultPlacement(choices, "laptop")?.deviceId).toBe("laptop");
		expect(defaultPlacement(choices, null)?.deviceId).toBe("host");
		expect(defaultPlacement(choices, "pc")?.deviceId).toBe("host");
		expect(defaultPlacement(placementChoices([laptop]), null)?.deviceId).toBe(
			"laptop",
		);
		expect(defaultPlacement(choices.slice(2), null)).toBeNull();
	});

	test("on a Host without the project, goes where the project's latest run ran", () => {
		const desktop = { deviceId: "desktop", name: "Desktop", thisDevice: false };
		const choices = placementChoices([laptop, { ...desktop, lastRun: true }]);
		expect(choices.map((c) => c.lastRun ?? false)).toEqual([false, true]);
		expect(defaultPlacement(choices, null)?.deviceId).toBe("desktop");
		expect(defaultPlacement(choices, "laptop")?.deviceId).toBe("laptop");
		// This computer has the project: it goes first.
		const withHost = placementChoices([host, { ...desktop, lastRun: true }]);
		expect(defaultPlacement(withHost, null)?.deviceId).toBe("host");
	});
});
