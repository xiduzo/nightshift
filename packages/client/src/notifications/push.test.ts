import { describe, expect, test } from "bun:test";

import { staleGates } from "./push";

describe("Gates that no longer wait", () => {
	const READ_AT = 1_000_000;
	const old = READ_AT - 60_000;

	const review = (runId: string, answerPending = false) => ({
		runId,
		stepId: "review",
		answerPending,
	});

	test("a shown Gate the inbox no longer has goes", () => {
		const shown = [
			{ id: "n1", key: "run-1:review", at: old },
			{ id: "n2", key: "run-2:review", at: old },
		];
		expect(staleGates(shown, [review("run-2")], READ_AT)).toEqual([
			{ id: "n1", key: "run-1:review", at: old },
		]);
	});

	test("a shown Gate with an answer on its way goes", () => {
		const shown = [{ key: "run-1:review", at: old }];
		expect(staleGates(shown, [review("run-1", true)], READ_AT)).toEqual(shown);
	});

	test("a run's end and other notifications stay", () => {
		const shown = [
			{ key: "run-1:end:7", at: old },
			{ key: "run-1:wait:build", at: old },
			{ key: null, at: old },
		];
		expect(staleGates(shown, [], READ_AT)).toEqual([]);
	});

	test("the end of quiet hours goes once no Gate waits, and stays while one does", () => {
		const shown = [{ key: "waiting:5", at: old }];
		expect(staleGates(shown, [review("run-1")], READ_AT)).toEqual([]);
		expect(staleGates(shown, [review("run-1", true)], READ_AT)).toEqual(shown);
		expect(staleGates(shown, [], READ_AT)).toEqual(shown);
	});

	test("a notification shown 10 s before the read stays: the read may not know its Gate yet", () => {
		const shown = [
			{ key: "run-1:review", at: READ_AT - 10_000 },
			{ key: "waiting:5", at: READ_AT - 10_000 },
		];
		expect(staleGates(shown, [], READ_AT)).toEqual([]);
	});

	test("one shown after the read stays too", () => {
		const shown = [{ key: "run-1:review", at: READ_AT + 1 }];
		expect(staleGates(shown, [], READ_AT)).toEqual([]);
	});
});
