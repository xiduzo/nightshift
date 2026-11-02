import { describe, expect, test } from "bun:test";

import {
	knownUseful,
	rememberedUseful,
	rememberUseful,
	USEFUL_ERROR,
	USEFUL_HINT,
	usefulLabel,
	usefulView,
} from "./useful";

function words(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

const pull = { prUrl: "https://github.com/acme/site/pull/7" };

describe("Useful on a digest run", () => {
	test("hides the control when the run opened no pull request", () => {
		expect(usefulView({ prUrl: null }, null)).toBe("hidden");
		expect(usefulView({ prUrl: "" }, null)).toBe("hidden");
	});

	test("asks once, then shows the choice", () => {
		expect(usefulView(pull, null)).toBe("ask");
		expect(usefulView(pull, true)).toBe("yes");
		expect(usefulView(pull, false)).toBe("no");
		expect(usefulLabel("yes")).toBe("Useful: Yes");
		expect(usefulLabel("no")).toBe("Useful: No");
	});

	test("reads a saved answer, and a tap in this window wins", () => {
		expect(knownUseful({ ...pull, useful: true }, null)).toBe(true);
		expect(knownUseful({ ...pull, useful: false }, null)).toBe(false);
		expect(knownUseful({ ...pull, useful: null }, null)).toBeNull();
		expect(knownUseful(pull, null)).toBeNull();
		expect(knownUseful({ ...pull, useful: true }, false)).toBe(false);
	});

	test("remembers a tap for that run", () => {
		rememberUseful("run-remember-web", false);
		expect(rememberedUseful("run-remember-web")).toBe(false);
		expect(rememberedUseful("run-other-web")).toBeNull();
	});

	test("the hint is one short sentence", () => {
		expect(USEFUL_HINT).toBe(
			"This helps Night Shift learn which runs are worth the cost.",
		);
		expect(words(USEFUL_HINT)).toBeLessThanOrEqual(20);
		expect(USEFUL_HINT.includes("'")).toBe(false);
		expect(USEFUL_HINT.includes(";")).toBe(false);
		expect(words(USEFUL_ERROR)).toBeLessThanOrEqual(20);
		expect(USEFUL_ERROR.includes("'")).toBe(false);
	});
});
