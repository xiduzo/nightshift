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

const pull = "https://github.com/acme/site/pull/7";
const useful = (value: number) => ({ score: "pr_useful", value });

describe("Useful on the run page", () => {
	test("hides the question when the run opened no pull request", () => {
		expect(usefulView(null, null)).toBe("hidden");
		expect(usefulView("", null)).toBe("hidden");
		expect(usefulView(undefined, null)).toBe("hidden");
	});

	test("asks once, then shows the choice", () => {
		expect(usefulView(pull, null)).toBe("ask");
		expect(usefulView(pull, true)).toBe("yes");
		expect(usefulView(pull, false)).toBe("no");
		expect(usefulLabel("yes")).toBe("You found this pull request useful");
		expect(usefulLabel("no")).toBe("You found this pull request not useful");
	});

	test("reads the last saved answer, and a tap in this window wins", () => {
		expect(knownUseful([useful(1)], null)).toBe(true);
		expect(knownUseful([useful(0)], null)).toBe(false);
		expect(knownUseful([useful(1), useful(0)], null)).toBe(false);
		expect(knownUseful([{ score: "pr_merged", value: 1 }], null)).toBeNull();
		expect(knownUseful(undefined, null)).toBeNull();
		expect(knownUseful([useful(1)], false)).toBe(false);
	});

	test("remembers a tap for that run", () => {
		rememberUseful("run-remember-web", false);
		expect(rememberedUseful("run-remember-web")).toBe(false);
		expect(rememberedUseful("run-other-web")).toBeNull();
	});

	test("the words are short and plain", () => {
		for (const text of [USEFUL_QUESTION, USEFUL_HINT, USEFUL_ERROR]) {
			expect(words(text)).toBeLessThanOrEqual(20);
			expect(text.includes("'")).toBe(false);
			expect(text.includes(";")).toBe(false);
		}
	});
});
