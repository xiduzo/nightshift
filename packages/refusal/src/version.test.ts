import { describe, expect, test } from "bun:test";

import {
	appVersionWords,
	deviceVersionWords,
	hostVersionWords,
	otherVersion,
	PROTOCOL_VERSION,
} from "./version";

describe("the version of another Night Shift", () => {
	test("the same number is no difference, and any other is", () => {
		expect(otherVersion(PROTOCOL_VERSION)).toBeNull();
		expect(otherVersion(PROTOCOL_VERSION + 1)).toBe("newer");
		expect(otherVersion(PROTOCOL_VERSION - 1)).toBe("older");
	});

	test("one that says no number is older", () => {
		for (const said of [undefined, null, "1", Number.NaN, {}]) {
			expect(otherVersion(said)).toBe("older");
		}
	});
});

describe("the words for a difference", () => {
	test("name the side to update", () => {
		expect(hostVersionWords("older")).toEndWith("Update Night Shift there.");
		expect(hostVersionWords("newer")).toEndWith("Update Night Shift here.");
		expect(deviceVersionWords("older")).toEndWith("Update Night Shift there.");
		expect(deviceVersionWords("newer")).toEndWith("Update Night Shift here.");
		expect(appVersionWords("phone", "older")).toBe(hostVersionWords("older"));
		expect(appVersionWords("phone", "newer")).toContain("Close the app");
		expect(appVersionWords("page", "older")).toContain("Reload this page.");
		expect(appVersionWords("page", "newer")).toContain("Reload this page.");
	});
});
