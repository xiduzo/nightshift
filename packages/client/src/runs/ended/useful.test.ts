import { describe, expect, test } from "bun:test";

import {
	knownUseful,
	rememberedUseful,
	rememberUseful,
	USEFUL_ERROR,
	USEFUL_HINT,
	USEFUL_QUESTION,
	usefulLabel,
	usefulView,
} from "./useful";

function words(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

const useful = (value: number) => ({ score: "useful", value });

describe("Useful on the run page", () => {
	test("asks only on a finished run, with or without a pull request", () => {
		expect(usefulView("finished", null, {})).toBe("ask");
		for (const status of [
			"running",
			"waiting",
			"failed",
			"stopped",
			"interrupted",
		] as const) {
			expect(usefulView(status, null, {})).toBe("hidden");
			expect(usefulView(status, true, {})).toBe("hidden");
		}
	});

	test("never asks on a test run, and hides an earlier answer too", () => {
		const test = { test: { pinned: ["fetch"], skipped: [] } };
		expect(usefulView("finished", null, test)).toBe("hidden");
		expect(usefulView("finished", true, test)).toBe("hidden");
	});

	test("asks once, then shows the choice", () => {
		expect(usefulView("finished", true, {})).toBe("yes");
		expect(usefulView("finished", false, {})).toBe("no");
		expect(usefulLabel("yes")).toBe("You found this run useful.");
		expect(usefulLabel("no")).toBe("You did not find this run useful.");
	});

	test("reads the last saved answer, and a tap in this app wins", () => {
		expect(knownUseful([useful(1)], null)).toBe(true);
		expect(knownUseful([useful(0)], null)).toBe(false);
		expect(knownUseful([useful(1), useful(0)], null)).toBe(false);
		expect(knownUseful([{ score: "pr_merged", value: 1 }], null)).toBeNull();
		expect(knownUseful(undefined, null)).toBeNull();
		expect(knownUseful([useful(1)], false)).toBe(false);
	});

	test("reads the answer an older Host sends as pr_useful", () => {
		expect(knownUseful([{ score: "pr_useful", value: 1 }], null)).toBe(true);
	});

	test("remembers a tap for that run", () => {
		rememberUseful("run-remember", false);
		expect(rememberedUseful("run-remember")).toBe(false);
		expect(rememberedUseful("run-other")).toBeNull();
	});

	test("the words are short and plain", () => {
		for (const text of [USEFUL_QUESTION, USEFUL_HINT, USEFUL_ERROR]) {
			expect(words(text)).toBeLessThanOrEqual(20);
			expect(text.includes("'")).toBe(false);
			expect(text.includes(";")).toBe(false);
		}
	});
});
