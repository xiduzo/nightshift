import { describe, expect, test } from "bun:test";

import { nextRunCursor } from "./queries";

const run = (id: string, createdAt: number, lastActivityAt = createdAt) => ({
	id,
	createdAt,
	lastActivityAt,
});

describe("the pages of a run list", () => {
	test("a full page goes on after its last run", () => {
		expect(nextRunCursor([run("b", 2), run("a", 1)], 2)).toEqual(run("a", 1));
	});

	test("a short page is the last", () => {
		expect(nextRunCursor([run("a", 1)], 2)).toBeUndefined();
	});

	test("a list by activity goes on after its last run's activity", () => {
		// The older run did something later: it comes first.
		const page = [run("a", 1, 9), run("b", 2, 8)];
		expect(nextRunCursor(page, 2)).toEqual(run("b", 2, 8));
	});
});
