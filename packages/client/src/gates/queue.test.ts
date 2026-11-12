import { describe, expect, test } from "bun:test";

import { gateOrder, mayAnswer, URGENCY_LABEL, urgencyOf } from "./queue";
import type { OpenGate } from "./types";

const MIN = 60_000;

type Queued = Pick<OpenGate, "runId" | "openedAt" | "deadline"> & {
	urgency?: OpenGate["urgency"];
};

function gate(runId: string, fields: Partial<Queued> = {}): Queued {
	return { runId, openedAt: 0, deadline: null, ...fields };
}

const due = (minutes: number) => ({ at: minutes * MIN, choose: "keep" });
const ids = (gates: readonly Queued[]) => gates.map((g) => g.runId);

describe("the urgency of a Gate", () => {
	test("the words of each level", () => {
		expect(URGENCY_LABEL).toEqual({
			now: "Now",
			today: "Today",
			later: "When you have time",
		});
	});

	test("a Host older than the brief sends none: today", () => {
		expect(urgencyOf({})).toBe("today");
		expect(urgencyOf({ urgency: "now" })).toBe("now");
	});
});

describe("gateOrder: the one queue order", () => {
	test("now, then today, then later, whatever the deadline", () => {
		const gates = [
			gate("later", { urgency: "later", deadline: due(1) }),
			gate("today", { urgency: "today", deadline: due(5) }),
			gate("now", { urgency: "now", openedAt: 9 }),
		];
		expect(ids(gateOrder(gates))).toEqual(["now", "today", "later"]);
	});

	test("in each level: a deadline first, the earliest first, then the oldest", () => {
		const gates = [
			gate("none-new", { openedAt: 2 }),
			gate("late", { deadline: due(30), openedAt: 0 }),
			gate("none-old", { openedAt: 1 }),
			gate("soon", { deadline: due(10), openedAt: 5 }),
		];
		expect(ids(gateOrder(gates))).toEqual([
			"soon",
			"late",
			"none-old",
			"none-new",
		]);
	});

	test("the same deadline: the oldest first", () => {
		const gates = [
			gate("new", { deadline: due(10), openedAt: 2 }),
			gate("old", { deadline: due(10), openedAt: 1 }),
		];
		expect(ids(gateOrder(gates))).toEqual(["old", "new"]);
	});

	test("a Gate without an urgency sorts as today", () => {
		const gates = [
			gate("later", { urgency: "later" }),
			gate("old-host", { openedAt: 5 }),
			gate("today", { urgency: "today", openedAt: 1 }),
		];
		expect(ids(gateOrder(gates))).toEqual(["today", "old-host", "later"]);
	});

	test("Gates that tie keep the order the Host sent, and the input stays", () => {
		expect(ids(gateOrder([gate("b"), gate("a")]))).toEqual(["b", "a"]);
		expect(ids(gateOrder([]))).toEqual([]);
		const sent = [gate("y", { openedAt: 2 }), gate("x", { openedAt: 1 })];
		expect(ids(gateOrder(sent))).toEqual(["x", "y"]);
		expect(ids(sent)).toEqual(["y", "x"]);
	});
});

describe("mayAnswer", () => {
	test("only a Gate your role lets you answer, and that nobody answered", () => {
		expect(mayAnswer({ canAnswer: true, answerPending: false })).toBe(true);
		expect(mayAnswer({ canAnswer: false, answerPending: false })).toBe(false);
		expect(mayAnswer({ canAnswer: true, answerPending: true })).toBe(false);
	});
});
