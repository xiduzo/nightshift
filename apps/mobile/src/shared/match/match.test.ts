/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { matches, queryWords } from "./match";

describe("matches", () => {
	test("needs every word somewhere in the fields, in any case", () => {
		const words = queryWords("  Plan  WEBSITE ");
		expect(words).toEqual(["plan", "website"]);
		expect(matches(words, ["Approve the plan", null, "website"])).toBe(true);
		expect(matches(words, ["Approve the plan", undefined])).toBe(false);
		expect(matches([], [])).toBe(true);
	});
});
