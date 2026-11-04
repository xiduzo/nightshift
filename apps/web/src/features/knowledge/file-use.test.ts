import { describe, expect, test } from "bun:test";
import { fileUse, isUnused } from "./file-use";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

const report = (lastRunAt: number | null) => ({
	since: 0,
	unusedDays: 30,
	runsUsedIt: true,
	files: [{ path: "a.md", found: 1, read: 1, lastAt: 1, lastRunAt }],
});

describe("isUnused", () => {
	test("an old file no run used lately is not used", () => {
		const use = fileUse(report(10 * DAY), NOW);
		expect(isUnused(use, { path: "a.md", changedAt: 1 })).toBe(true);
		expect(isUnused(use, { path: "b.md", changedAt: 1 })).toBe(true);
	});

	test("a file a run used lately is used", () => {
		const use = fileUse(report(90 * DAY), NOW);
		expect(isUnused(use, { path: "a.md", changedAt: 1 })).toBe(false);
	});

	test("a file that came in lately says nothing yet", () => {
		const use = fileUse(report(null), NOW);
		expect(isUnused(use, { path: "a.md", changedAt: 99 * DAY })).toBe(false);
	});

	test("no run used the knowledge at all: mark nothing", () => {
		const use = fileUse({ ...report(null), runsUsedIt: false }, NOW);
		expect(isUnused(use, { path: "a.md", changedAt: 1 })).toBe(false);
	});
});
