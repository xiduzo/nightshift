/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { OpenGate, RunSummary } from "@nightshift/client";

import {
	firstDeadline,
	headIndices,
	needsItems,
	needsRows,
	needsSummary,
	needsTabLabel,
} from "./queue";

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

type L = { projectId: string; id: string };
const learning: L = { projectId: "web", id: "l1" };

const time = (at: number) => `t${at / MIN}`;

describe("needsItems", () => {
	test("only the Gates you may answer, in queue order", () => {
		const items = needsItems<L>({
			gates: [
				gate({ runId: "old", openedAt: 1 }),
				gate({ runId: "read-only", canAnswer: false }),
				gate({ runId: "answered", answerPending: true }),
				gate({ runId: "soon", deadline: { at: 10 * MIN, choose: "keep" } }),
				gate({ runId: "now", urgency: "now", openedAt: 9 }),
			],
			runs: undefined,
			learnings: undefined,
		});
		expect(items.map((item) => item.key)).toEqual([
			"gate:now:s1",
			"gate:soon:s1",
			"gate:old:s1",
		]);
	});

	test("the Gates, then the runs, then the learnings", () => {
		const items = needsItems<L>({
			gates: [gate({ runId: "g" })],
			runs: [run("x"), run("y")],
			learnings: [learning],
		});
		expect(items.map((item) => item.key)).toEqual([
			"gate:g:s1",
			"run:x",
			"run:y",
			"learning:web:l1",
		]);
	});

	test("a part that loads adds nothing yet", () => {
		expect(
			needsItems<L>({ gates: undefined, runs: undefined, learnings: [] }),
		).toEqual([]);
	});
});

describe("needsRows", () => {
	test("a head per section that holds something, and where each card starts and ends", () => {
		const rows = needsRows(
			needsItems<L>({
				gates: [gate({ runId: "g" })],
				runs: undefined,
				learnings: [learning, { projectId: "web", id: "l2" }],
			}),
		);
		expect(
			rows.map((row) =>
				row.kind === "head"
					? `head:${row.section}:${row.count}:${row.top}`
					: `${row.key}:${row.first}:${row.last}`,
			),
		).toEqual([
			"head:today:1:true",
			"gate:g:s1:true:true",
			"head:learning:2:false",
			"learning:web:l1:true:false",
			"learning:web:l2:false:true",
		]);
		expect(headIndices(rows)).toEqual([0, 2]);
	});

	test("the Gates split by urgency: now, today, when you have time", () => {
		const rows = needsRows(
			needsItems<L>({
				gates: [
					gate({ runId: "later", urgency: "later" }),
					gate({ runId: "old" }),
					gate({ runId: "today", urgency: "today", openedAt: 5 }),
					gate({ runId: "now", urgency: "now", openedAt: 9 }),
				],
				runs: [run("x")],
				learnings: undefined,
			}),
		);
		expect(
			rows.map((row) =>
				row.kind === "head" ? `head:${row.section}:${row.count}` : row.key,
			),
		).toEqual([
			"head:now:1",
			"gate:now:s1",
			"head:today:2",
			"gate:old:s1",
			"gate:today:s1",
			"head:later:1",
			"gate:later:s1",
			"head:run:1",
			"run:x",
		]);
	});

	test("nothing waits: no rows", () => {
		expect(needsRows([])).toEqual([]);
	});
});

describe("needsSummary", () => {
	test("how many things, and when the first Gate closes", () => {
		const items = needsItems<L>({
			gates: [
				gate({ runId: "a", deadline: { at: 90 * MIN, choose: "keep" } }),
				gate({ runId: "b", deadline: { at: 30 * MIN, choose: "keep" } }),
			],
			runs: [run("x")],
			learnings: undefined,
		});
		expect(needsSummary(items, time)).toBe(
			"3 things. The first Gate closes at t30.",
		);
	});

	test("the first deadline of any Gate, also when a Gate for now has none", () => {
		const items = needsItems<L>({
			gates: [
				gate({ runId: "a", urgency: "now" }),
				gate({ runId: "b", deadline: { at: 30 * MIN, choose: "keep" } }),
			],
			runs: undefined,
			learnings: undefined,
		});
		expect(firstDeadline(items)).toBe(30 * MIN);
		expect(needsSummary(items, time)).toBe(
			"2 things. The first Gate closes at t30.",
		);
	});

	test("a Gate without a deadline, no Gate, nothing", () => {
		const one = needsItems<L>({
			gates: [gate({})],
			runs: undefined,
			learnings: undefined,
		});
		expect(needsSummary(one, time)).toBe("1 thing. A Gate waits for you.");
		const noGate = needsItems<L>({
			gates: [],
			runs: [run("x")],
			learnings: undefined,
		});
		expect(needsSummary(noGate, time)).toBe("1 thing. No Gate is open.");
		expect(needsSummary([], time)).toBe("Nothing needs you");
	});
});

describe("needsTabLabel", () => {
	test("what a screen reader says for the tab", () => {
		expect(needsTabLabel(0)).toBe("Needs you");
		expect(needsTabLabel(1)).toBe("Needs you, 1 thing waits for you");
		expect(needsTabLabel(3)).toBe("Needs you, 3 things wait for you");
	});
});
