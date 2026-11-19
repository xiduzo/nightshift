import { describe, expect, test } from "bun:test";
import { inboxOrder } from "./inbox-order";

/** A Gate as the order reads it. */
const gate = (runId: string, openedAt: number, stepId = `step-${runId}`) => ({
	runId,
	openedAt,
	stepId,
});

describe("inboxOrder", () => {
	test("puts the Gate that has waited longest first", () => {
		const gates = [gate("b", 20), gate("a", 10)];
		expect(inboxOrder(gates).map((g) => g.runId)).toEqual(["a", "b"]);
		// It leaves the list it was given as it was.
		expect(gates.map((g) => g.runId)).toEqual(["b", "a"]);
	});

	test("keeps one order for Gates that opened at the same moment", () => {
		const gates = [gate("b", 5, "s1"), gate("a", 5, "s2"), gate("a", 5, "s1")];
		expect(inboxOrder(gates).map((g) => `${g.runId}:${g.stepId}`)).toEqual([
			"a:s1",
			"a:s2",
			"b:s1",
		]);
	});
});
