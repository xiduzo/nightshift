/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { OpenGate, RunSummary } from "@nightshift/client";

import {
	gateOrder,
	gatesForYou,
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

describe("gatesForYou and gateOrder", () => {
	test("only the Gates you may answer and nobody answered", () => {
		const gates = [
			gate({ runId: "a" }),
			gate({ runId: "b", canAnswer: false }),
			gate({ runId: "c", answerPending: true }),
		];
		expect(gatesForYou(gates).map((g) => g.runId)).toEqual(["a"]);
	});

	test("the first to close first, then the oldest without a deadline", () => {
		const gates = [
			gate({ runId: "none-new", openedAt: 2 }),
			gate({ runId: "late", deadline: { at: 30 * MIN, choose: "keep" } }),
			gate({ runId: "none-old", openedAt: 1 }),
			gate({ runId: "soon", deadline: { at: 10 * MIN, choose: "keep" } }),
		];
		expect(gateOrder(gates).map((g) => g.runId)).toEqual([
			"soon",
			"late",
			"none-old",
			"none-new",
		]);
	});
});

describe("needsItems", () => {
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
			"head:gate:1:true",
			"gate:g:s1:true:true",
			"head:learning:2:false",
			"learning:web:l1:true:false",
			"learning:web:l2:false:true",
		]);
		expect(headIndices(rows)).toEqual([0, 2]);
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
