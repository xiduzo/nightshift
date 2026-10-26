import { describe, expect, test } from "bun:test";

import { scrollTopNear } from "./caret";

describe("scrollTopNear", () => {
	test("a cursor at the top stays at the top", () => {
		expect(scrollTopNear("a\nb\nc\nd", 0, 400, 400)).toBe(0);
		expect(scrollTopNear("one line", 3, 20, 100)).toBe(0);
	});

	test("a cursor further down scrolls by its share of the lines", () => {
		const text = Array.from({ length: 10 }, (_, line) => `line ${line}`).join(
			"\n",
		);
		// The cursor on the eighth line of ten.
		const start = text.indexOf("line 7");
		expect(scrollTopNear(text, start, 1000, 200)).toBe(700);
	});

	test("a field that fits never scrolls", () => {
		expect(scrollTopNear("", 0, 100, 100)).toBe(0);
		expect(scrollTopNear("a\nb", 2, 40, 100)).toBe(0);
	});

	test("a cursor on the last line scrolls no further than the end", () => {
		expect(scrollTopNear("a\nb\nc\nd", 6, 400, 100)).toBe(300);
	});
});
