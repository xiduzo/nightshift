import { describe, expect, test } from "bun:test";

import {
	isTestRun,
	standInLabel,
	TEST_RUN_HINT,
	TEST_RUN_LABEL,
} from "./test-run";

describe("a test run on every screen", () => {
	test("is a run whose summary names its pins and skips", () => {
		expect(isTestRun({ test: { pinned: [], skipped: ["check"] } })).toBe(true);
		expect(isTestRun({})).toBe(false);
	});

	test("a step that stood in says what it gave", () => {
		expect(standInLabel("pinned")).toBe("Pinned output");
		expect(standInLabel("skipped")).toBe("Skipped");
	});

	test("the words are short and plain", () => {
		for (const text of [TEST_RUN_LABEL, TEST_RUN_HINT]) {
			for (const sentence of text.split(/(?<=\.)\s+/)) {
				expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20);
			}
			expect(text.includes("'")).toBe(false);
			expect(text.includes(";")).toBe(false);
		}
	});
});
