import { describe, expect, test } from "bun:test";
import { KEPT_WORK_DAYS, keptWorkFate, keptWorkGone } from "./kept-work";

const DAY_MS = 24 * 60 * 60_000;
const NOW = 100 * DAY_MS;
const daysAgo = (days: number) => NOW - days * DAY_MS;

describe("keptWorkFate", () => {
	test.each([
		["a run that ended 30 days ago", daysAgo(30), null, false, "free"],
		["a run that ended 29 days ago", daysAgo(29), null, false, "keep"],
		["a run that ended 90 days ago", daysAgo(90), null, false, "free"],
		["an open run that ended long ago", daysAgo(90), null, true, "keep"],
		[
			"the run's end, not when it was kept",
			daysAgo(10),
			daysAgo(40),
			false,
			"keep",
		],
		[
			"a run this computer does not know, kept 30 days ago",
			null,
			daysAgo(30),
			false,
			"free",
		],
		[
			"a run this computer does not know, kept 2 days ago",
			null,
			daysAgo(2),
			false,
			"keep",
		],
		["a run nothing tells the age of", null, null, false, "keep"],
	] as const)("%s", (_, endedAt, keptAt, open, fate) => {
		expect(keptWorkFate({ endedAt, keptAt, open, now: NOW })).toBe(fate);
	});

	test("the days are 30", () => {
		expect(KEPT_WORK_DAYS).toBe(30);
	});
});

describe("keptWorkGone", () => {
	const kept = { kept: true, expired: false };
	const freed = { kept: false, expired: true };
	const copyOnly = { kept: false, expired: false };
	test.each([
		["no removal", [], false],
		["kept", [kept], false],
		["kept, then freed", [kept, freed], true],
		["freed, then a removal that kept nothing", [kept, freed, copyOnly], true],
		["freed, then kept again", [kept, freed, kept], false],
	] as const)("%s", (_, removals, gone) => {
		expect(keptWorkGone(removals)).toBe(gone);
	});
});
