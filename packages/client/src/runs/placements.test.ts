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

	test("goes where the person chose, else where Night Shift marks the default, else the first", () => {
		const desktop = { deviceId: "desktop", name: "Desktop", thisDevice: false };
		const choices = placementChoices(
			[host, { ...desktop, lastRun: true, default: true }],
			[device("pc", false)],
		);
		expect(choices.map((c) => c.default ?? false)).toEqual([
			false,
			true,
			false,
		]);
		expect(defaultPlacement(choices, null)?.deviceId).toBe("desktop");
		expect(defaultPlacement(choices, "host")?.deviceId).toBe("host");
		// An offline choice is not where a run goes.
		expect(defaultPlacement(choices, "pc")?.deviceId).toBe("desktop");
		// A Host of an older version marks no default.
		expect(
			defaultPlacement(placementChoices([laptop, host]), null)?.deviceId,
		).toBe("laptop");
		expect(defaultPlacement(choices.slice(2), null)).toBeNull();
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
