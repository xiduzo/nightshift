import { describe, expect, test } from "bun:test";

import { nextRunCursor } from "./queries";

const run = (id: string, createdAt: number) => ({ id, createdAt });

describe("the pages of a run list", () => {
	test("a full page goes on after its last run", () => {
		expect(nextRunCursor([run("b", 2), run("a", 1)], 2, undefined)).toEqual(
			run("a", 1),
		);
	});

	test("a short page is the last", () => {
		expect(nextRunCursor([run("a", 1)], 2, undefined)).toBeUndefined();
	});

	test("an older Host that sends every run gives one page", () => {
		// Longer than asked: it ignored the limit.
		expect(
			nextRunCursor([run("c", 3), run("b", 2), run("a", 1)], 2, undefined),
		).toBeUndefined();
		// Exactly as long, but not after the cursor: it ignored the cursor.
		expect(
			nextRunCursor([run("b", 2), run("a", 1)], 2, run("a", 1)),
		).toBeUndefined();
	});

	test("a page after the cursor goes on, also past runs of the same moment", () => {
		expect(nextRunCursor([run("b", 5), run("a", 4)], 2, run("c", 5))).toEqual(
			run("a", 4),
		);
	});
});
