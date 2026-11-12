import { describe, expect, test } from "bun:test";
import { isTestRun } from "./index";

describe("isTestRun", () => {
	test("a run with pins or skips is a test run", () => {
		expect(isTestRun({ test: { pinned: ["fetch"], skipped: [] } })).toBe(true);
		expect(
			isTestRun({ test: { pinned: {}, skipped: { check: "pass" } } }),
		).toBe(true);
	});

	test("a run without a test is not one: absent in a summary, null in the log", () => {
		expect(isTestRun({})).toBe(false);
		expect(isTestRun({ test: undefined })).toBe(false);
		expect(isTestRun({ test: null })).toBe(false);
	});
});
