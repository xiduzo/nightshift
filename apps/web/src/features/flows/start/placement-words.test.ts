import { describe, expect, test } from "bun:test";
import { placementDescription } from "./placement-words";

describe("the Device field of Start run", () => {
	test("names the Host admin of a Host that another person runs, as the phone does", () => {
		expect(
			placementDescription(
				{ thisDevice: true, offers: [], ownerName: "Ada" },
				false,
			),
		).toBe("This Host belongs to Ada. Ada has not offered it to this Space.");
		expect(
			placementDescription(
				{ thisDevice: true, offers: ["builder"], ownerName: "Ada" },
				false,
			),
		).toBe("This Host belongs to Ada. Ada offers builder to this Space.");
	});

	test("a Host of another person without a name says another person", () => {
		expect(placementDescription({ thisDevice: true, offers: [] }, false)).toBe(
			"This Host belongs to another person. It offers no profiles to this Space.",
		);
	});

	test("another person's device, one of your own, and no device online", () => {
		expect(
			placementDescription({ thisDevice: false, offers: ["coder"] }, false),
		).toBe(
			"Another person's device. The run can use only the profiles it offers to this Space.",
		);
		expect(placementDescription({ thisDevice: false }, false)).toBe(
			"Pick one of your online devices with this project, or a device that others offer to this Space.",
		);
		expect(placementDescription(undefined, true)).toBe(
			"None of your devices with this project is online. Start the run when one is.",
		);
	});
});
