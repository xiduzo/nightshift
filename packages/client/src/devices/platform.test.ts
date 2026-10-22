import { describe, expect, test } from "bun:test";

import { platformName } from "./platform";

describe("a platform as people say it", () => {
	test("names the three systems, and keeps any other name", () => {
		expect(platformName("darwin")).toBe("macOS");
		expect(platformName("linux")).toBe("Linux");
		expect(platformName("win32")).toBe("Windows");
		expect(platformName("freebsd")).toBe("freebsd");
		expect(platformName(null)).toBe("Unknown system");
	});
});
