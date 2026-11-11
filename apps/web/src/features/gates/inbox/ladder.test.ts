import { describe, expect, test } from "bun:test";

import { ladderOf, reachText, rowLine } from "./ladder";

const gate = (
	id: string,
	urgency: "now" | "today" | "later",
	openedAt: number,
) => ({ id, urgency, openedAt });

describe("the inbox ladder", () => {
	test("puts Now first, then Today, then later, the oldest first in each", () => {
		const groups = ladderOf([
			gate("a", "today", 30),
			gate("b", "later", 10),
			gate("c", "now", 50),
			gate("d", "today", 20),
			gate("e", "now", 40),
		]);
		expect(groups.map((g) => [g.urgency, g.gates.map((x) => x.id)])).toEqual([
			["now", ["e", "c"]],
			["today", ["d", "a"]],
			["later", ["b"]],
		]);
	});

	test("leaves out a level without Gates", () => {
		expect(ladderOf([gate("a", "later", 1)]).map((g) => g.urgency)).toEqual([
			"later",
		]);
		expect(ladderOf([])).toEqual([]);
	});
});

describe("the row line", () => {
	test("is the first line of the situation", () => {
		expect(
			rowLine({
				question: "Merge it?\n\nThe tests pass.",
				brief: { situation: "\nThe release waits on this.\nMore." },
			}),
		).toBe("The release waits on this.");
	});

	test("falls back to the first line below the title", () => {
		expect(
			rowLine({
				question: "Merge it?\n\nThe tests pass.\nAll of them.",
				brief: { situation: null },
			}),
		).toBe("The tests pass.");
	});

	test("is null when the question is only a title", () => {
		expect(rowLine({ question: "Merge it?", brief: { situation: "  " } })).toBe(
			null,
		);
	});
});

describe("how a level reaches you", () => {
	test("says a notification goes out only for the levels you push", () => {
		expect(reachText("now", ["now"])).toBe(
			"Night Shift also sends you a notification.",
		);
		expect(reachText("later", ["now"])).toBe("Only here in the inbox.");
		expect(reachText("now", undefined)).toBeNull();
	});
});
