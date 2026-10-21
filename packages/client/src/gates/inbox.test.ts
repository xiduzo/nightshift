import { describe, expect, test } from "bun:test";

import {
	changesInbox,
	gateKey,
	gateRun,
	inboxOrder,
	isGateClosed,
	waitedText,
	waitingForYou,
} from "./inbox";

const MINUTE = 60_000;

describe("gateKey", () => {
	test("names a Gate by its run and its step", () => {
		expect(gateKey({ runId: "run-1", stepId: "review" })).toBe("run-1:review");
	});
});

describe("inboxOrder", () => {
	test("the Gate that has waited longest comes first", () => {
		const gates = [
			{ runId: "r2", stepId: "a", openedAt: 300 },
			{ runId: "r1", stepId: "a", openedAt: 100 },
			{ runId: "r3", stepId: "a", openedAt: 200 },
		];
		expect(inboxOrder(gates).map((gate) => gate.runId)).toEqual([
			"r1",
			"r3",
			"r2",
		]);
	});

	test("Gates of the same moment keep one order, by run and step", () => {
		const gates = [
			{ runId: "r2", stepId: "a", openedAt: 100 },
			{ runId: "r1", stepId: "b", openedAt: 100 },
			{ runId: "r1", stepId: "a", openedAt: 100 },
		];
		expect(
			inboxOrder(gates).map((gate) => `${gate.runId}:${gate.stepId}`),
		).toEqual(["r1:a", "r1:b", "r2:a"]);
	});

	test("leaves the list it gets as it is", () => {
		const gates = [
			{ runId: "r2", stepId: "a", openedAt: 2 },
			{ runId: "r1", stepId: "a", openedAt: 1 },
		];
		inboxOrder(gates);
		expect(gates[0]?.runId).toBe("r2");
	});
});

describe("waitingForYou", () => {
	test("counts only the Gates you may answer", () => {
		expect(
			waitingForYou([
				{ canAnswer: true },
				{ canAnswer: false },
				{ canAnswer: true },
			]),
		).toBe(2);
		expect(waitingForYou([])).toBe(0);
	});
});

describe("waitedText", () => {
	test("under a minute, also for a clock that runs behind", () => {
		expect(waitedText(0)).toBe("under a minute");
		expect(waitedText(59_999)).toBe("under a minute");
		expect(waitedText(-5 * MINUTE)).toBe("under a minute");
	});

	test("minutes, then hours and minutes", () => {
		expect(waitedText(MINUTE)).toBe("1 min");
		expect(waitedText(59 * MINUTE)).toBe("59 min");
		expect(waitedText(60 * MINUTE)).toBe("1 h");
		expect(waitedText(185 * MINUTE)).toBe("3 h 5 min");
	});

	test("days", () => {
		expect(waitedText(24 * 60 * MINUTE)).toBe("1 day");
		expect(waitedText(3 * 24 * 60 * MINUTE + 5 * MINUTE)).toBe("3 days");
	});
});

describe("changesInbox", () => {
	test("a Gate that opens or closes changes the inbox, a run end does not", () => {
		expect(changesInbox({ kind: "gate-opened" })).toBe(true);
		expect(changesInbox({ kind: "gate-closed" })).toBe(true);
		expect(changesInbox({ kind: "run-finished" })).toBe(false);
		expect(changesInbox({ kind: "gates-waiting" })).toBe(false);
	});
});

describe("isGateClosed", () => {
	test("the refusal of an answer to a closed Gate", () => {
		expect(isGateClosed({ code: "BAD_REQUEST" })).toBe(true);
		expect(isGateClosed({ code: "NOT_FOUND" })).toBe(false);
		expect(isGateClosed(new Error("offline"))).toBe(false);
		expect(isGateClosed(null)).toBe(false);
	});
});

describe("gateRun", () => {
	test("names the flow, and what sets this run apart", () => {
		expect(
			gateRun({ flowName: "ship", runTitle: "ship · ticket PZ-12" }),
		).toEqual({ flow: "ship", detail: "ticket PZ-12" });
	});

	test("a flow run without inputs has no detail", () => {
		expect(gateRun({ flowName: "ship", runTitle: "ship" })).toEqual({
			flow: "ship",
			detail: null,
		});
	});

	test("a quick run shows its prompt", () => {
		expect(gateRun({ flowName: null, runTitle: "Fix the login" })).toEqual({
			flow: "Quick run",
			detail: "Fix the login",
		});
	});

	test("a title that does not start with the flow name stays whole", () => {
		expect(gateRun({ flowName: "ship", runTitle: "Nightly" })).toEqual({
			flow: "ship",
			detail: "Nightly",
		});
	});
});
