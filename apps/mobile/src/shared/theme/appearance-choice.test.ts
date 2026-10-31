/// <reference types="bun" />
import { expect, test } from "bun:test";

import { APPEARANCES, appearanceOf } from "./appearance-choice";

test("a kept appearance is dark, light, or else the phone's", () => {
	expect(appearanceOf("dark")).toBe("dark");
	expect(appearanceOf("light")).toBe("light");
	expect(appearanceOf("system")).toBe("system");
	expect(appearanceOf(null)).toBe("system");
	expect(appearanceOf("sepia")).toBe("system");
});

test("Settings offers dark first, then light, then the phone's", () => {
	expect(APPEARANCES.map((choice) => choice.value)).toEqual([
		"dark",
		"light",
		"system",
	]);
});
