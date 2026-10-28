import { describe, expect, test } from "bun:test";

import {
	defaultPlacement,
	hostOwnerHint,
	placementChoices,
} from "./placements";

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

	test("on a Host another person owns that offers you nothing, goes to one of your own Devices", () => {
		const theirs = { ...host, offers: [] };
		const choices = placementChoices([theirs, laptop]);
		expect(defaultPlacement(choices, null)?.deviceId).toBe("laptop");
		// Not to the latest run's Device either, when it is that Host.
		const last = placementChoices([{ ...theirs, lastRun: true }, laptop]);
		expect(defaultPlacement(last, null)?.deviceId).toBe("laptop");
		// The person can still choose it.
		expect(defaultPlacement(choices, "host")?.deviceId).toBe("host");
		// When it offers a profile, it stays the default.
		const offering = placementChoices([
			{ ...host, offers: ["claude"] },
			laptop,
		]);
		expect(defaultPlacement(offering, null)?.deviceId).toBe("host");
	});
});

describe("the words for a Host that another person runs", () => {
	test("name the Host admin and what they offer to this Space", () => {
		expect(
			hostOwnerHint({ thisDevice: true, offers: [], ownerName: "Ada" }),
		).toBe("This Host belongs to Ada. Ada has not offered it to this Space.");
		expect(
			hostOwnerHint({
				thisDevice: true,
				offers: ["builder", "coder"],
				ownerName: "Ada",
			}),
		).toBe(
			"This Host belongs to Ada. Ada offers builder, coder to this Space.",
		);
	});

	test("say another person without a name, and nothing for your own places", () => {
		expect(hostOwnerHint({ thisDevice: true, offers: ["coder"] })).toBe(
			"This Host belongs to another person. It offers coder to this Space.",
		);
		expect(hostOwnerHint({ thisDevice: true })).toBeNull();
		expect(hostOwnerHint({ thisDevice: false, offers: ["coder"] })).toBeNull();
	});
});
