/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { OpenGate, RunSummary } from "@nightshift/client";

import { needsItems, needsTabLabel } from "./queue";

const MIN = 60_000;

function gate(fields: Partial<OpenGate>): OpenGate {
	return {
		runId: "r1",
		stepId: "s1",
		openedAt: 0,
		deadline: null,
		canAnswer: true,
		answerPending: false,
		...fields,
	} as OpenGate;
}

function run(id: string): RunSummary {
	return { id } as RunSummary;
}

describe("needsItems", () => {
	test("only the Gates you may answer, in queue order", () => {
		const items = needsItems({
			gates: [
				gate({ runId: "old", openedAt: 1 }),
				gate({ runId: "read-only", canAnswer: false }),
				gate({ runId: "answered", answerPending: true }),
				gate({ runId: "soon", deadline: { at: 10 * MIN, choose: "keep" } }),
				gate({ runId: "now", urgency: "now", openedAt: 9 }),
			],
			runs: undefined,
		});
		expect(items.map((item) => item.key)).toEqual([
			"gate:now:s1",
			"gate:soon:s1",
			"gate:old:s1",
		]);
	});

	test("the Gates, then the runs", () => {
		const items = needsItems({
			gates: [gate({ runId: "g" })],
			runs: [run("x"), run("y")],
		});
		expect(items.map((item) => item.key)).toEqual([
			"gate:g:s1",
			"run:x",
			"run:y",
		]);
	});

	test("a part that loads adds nothing yet", () => {
		expect(needsItems({ gates: undefined, runs: [] })).toEqual([]);
	});
});

describe("needsTabLabel", () => {
	test("what a screen reader says for the tab", () => {
		expect(needsTabLabel(0)).toBe("Needs you");
		expect(needsTabLabel(1)).toBe("Needs you, 1 thing waits for you");
		expect(needsTabLabel(3)).toBe("Needs you, 3 things wait for you");
	});
});
