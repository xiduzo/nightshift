import { describe, expect, test } from "bun:test";

import { staleGates } from "./push";

describe("Gates that no longer wait", () => {
	const READ_AT = 1_000_000;
	const old = READ_AT - 60_000;

	test("a shown Gate the inbox no longer has goes", () => {
		const shown = [
			{ id: "n1", key: "run-1:review", at: old },
			{ id: "n2", key: "run-2:review", at: old },
		];
		expect(staleGates(shown, new Set(["run-2:review"]), READ_AT)).toEqual([
			{ id: "n1", key: "run-1:review", at: old },
		]);
	});

	test("a run's end, the end of quiet hours and other notifications stay", () => {
		const shown = [
			{ key: "run-1:end:7", at: old },
			{ key: "waiting:5", at: old },
			{ key: null, at: old },
		];
		expect(staleGates(shown, new Set(), READ_AT)).toEqual([]);
	});

	test("a notification shown 10 s before the read stays: the read may not know its Gate yet", () => {
		const shown = [{ key: "run-1:review", at: READ_AT - 10_000 }];
		expect(staleGates(shown, new Set(), READ_AT)).toEqual([]);
	});

	test("one shown after the read stays too", () => {
		const shown = [{ key: "run-1:review", at: READ_AT + 1 }];
		expect(staleGates(shown, new Set(), READ_AT)).toEqual([]);
	});
});
