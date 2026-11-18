import { describe, expect, test } from "bun:test";
import {
	changeSummary,
	moveKindOf,
	moveStep,
	moveText,
	moveTone,
	verdictLabel,
} from "./changes";

const format = {
	cost: (usd: number) => `$${usd.toFixed(2)}`,
	time: (ms: number) => `${Math.round(ms / 60_000)} min`,
};

const change = {
	firstAt: 0,
	at: 0,
	saves: 2,
	added: 1,
	removed: 0,
	changed: 5,
	edges: 1,
	settings: 0,
};

describe("before and after in words", () => {
	test("a change says what it changed", () => {
		expect(changeSummary(change)).toBe(
			"Added 1 step, changed 5 steps, changed 1 edge",
		);
		expect(changeSummary({ ...change, added: 0, changed: 0, edges: 0 })).toBe(
			"Changed the flow",
		);
	});

	test("a verdict with too few runs says so", () => {
		expect(verdictLabel("few")).toBe("Too few runs to tell");
	});

	test("a move says what to do and why", () => {
		const move = {
			kind: "sameAnswer" as const,
			nodeId: "review",
			choice: "ready",
			times: 5,
			of: 6,
			deadline: false,
			runId: "r",
		};
		expect(moveText(move, format)).toEqual({
			title: "Let review go on with “ready” unless you object",
			why: "You chose “ready” 5 of 6 times.",
		});
		expect(moveTone(move)).toBe("up");
		expect(moveStep(move)).toBe("review");
	});

	test("a move with money and time formats them", () => {
		expect(
			moveText(
				{
					kind: "loop",
					nodeId: "slide",
					from: "capture",
					outcome: "broken",
					times: 3,
					rounds: 2,
					extraUsd: 4.5,
					runId: "r",
				},
				format,
			).why,
		).toBe(
			"capture sent the run back to slide on “broken” 3 times. The extra rounds cost $4.50.",
		);
	});

	test("a move is known by its kind", () => {
		expect(moveKindOf("edge")).toBe("edge");
		expect(moveKindOf("nope")).toBeUndefined();
	});
});
