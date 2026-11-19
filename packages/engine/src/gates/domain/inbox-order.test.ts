import { describe, expect, test } from "bun:test";
import { answeredOrder, INBOX_KEEP_MS } from "./inbox-order";

const closed = (runId: string, closedAt: number, stepId = "s") => ({
	runId,
	stepId,
	closedAt,
});

describe("answeredOrder", () => {
	test("puts the Gate that closed last first", () => {
		const gates = [closed("a", 10), closed("b", 20)];
		expect(answeredOrder(gates).map((g) => g.runId)).toEqual(["b", "a"]);
		// It leaves the list it was given as it was.
		expect(gates.map((g) => g.runId)).toEqual(["a", "b"]);
	});

	test("keeps one order for Gates that closed at the same moment", () => {
		const gates = [
			closed("b", 5, "s1"),
			closed("a", 5, "s2"),
			closed("a", 5, "s1"),
		];
		expect(answeredOrder(gates).map((g) => `${g.runId}:${g.stepId}`)).toEqual([
			"a:s1",
			"a:s2",
			"b:s1",
		]);
	});
});

test("the inbox keeps 90 days, as runs", () => {
	expect(INBOX_KEEP_MS).toBe(90 * 24 * 60 * 60 * 1000);
});
