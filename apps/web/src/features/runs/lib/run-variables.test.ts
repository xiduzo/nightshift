import { describe, expect, test } from "bun:test";
import type { StepSummary } from "@nightshift/client";
import { FLOW_VERSION, type Flow } from "@nightshift/flows";
import { previewValue, scopeLabel, variableGroups } from "./run-variables";

const origin = { x: 0, y: 0 };

const flow: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	variables: [
		{ name: "tries", type: "number" },
		{ name: "failures", type: "json", description: "Each failed check." },
	],
	start: "check",
	nodes: [
		{
			id: "check",
			type: "command",
			position: origin,
			command: "true",
			output: "text",
		},
		{ id: "sub", type: "call", position: origin, flow: "counter", inputs: {} },
	],
	edges: [],
};

const counter: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	variables: [{ name: "count", type: "number" }],
	start: "peek",
	nodes: [
		{
			id: "peek",
			type: "command",
			position: origin,
			command: "true",
			output: "text",
		},
	],
	edges: [],
};

/** Only the fields the helpers read. */
const step = (id: string, nodeId: string, extra: Partial<StepSummary> = {}) =>
	({
		id,
		nodeId,
		scope: null,
		items: [],
		nodeType: "command",
		...extra,
	}) as StepSummary;

const steps = [
	step("s1", "check"),
	step("s2", "sub", { nodeType: "call" }),
	step("s3", "peek", { scope: { parentStepId: "s2", itemId: null } }),
];

const change = (
	name: string,
	value: unknown,
	stepId: string | null,
	scope: { parentStepId: string; itemId: string | null } | null = null,
	at = 0,
) => ({ name, value, stepId, scope, at }) as never;

describe("variableGroups", () => {
	const run = {
		flow,
		calledFlows: { counter },
		variables: [
			change("count", 0, null, { parentStepId: "s2", itemId: null }),
			change("failures", [], null),
			change("tries", 0, null),
			change("tries", 1, "s1"),
			change("count", 1, "s3", { parentStepId: "s2", itemId: null }),
			change("old", "x", "s1"),
		],
	};

	test("the run's own flow first, then each call; declared order, then the rest", () => {
		const groups = variableGroups(run, steps);
		expect(groups.map((group) => group.key)).toEqual(["", "s2:"]);
		expect(groups[0]?.rows.map((row) => row.name)).toEqual([
			"tries",
			"failures",
			"old",
		]);
		expect(groups[1]?.rows.map((row) => [row.name, row.type])).toEqual([
			["count", "number"],
		]);
	});

	test("each row has its value now and every value, oldest first", () => {
		const [top] = variableGroups(run, steps);
		const tries = top?.rows[0];
		expect(tries?.last).toMatchObject({ value: 1, stepId: "s1" });
		expect(tries?.history.map((one) => one.value)).toEqual([0, 1]);
		expect(top?.rows[1]).toMatchObject({
			type: "json",
			description: "Each failed check.",
		});
		expect(top?.rows[2]?.type).toBeUndefined();
	});

	test("no changes, no groups", () => {
		expect(variableGroups({ ...run, variables: [] }, steps)).toEqual([]);
	});
});

describe("scopeLabel", () => {
	test("the Call step's node and the flow it called", () => {
		expect(
			scopeLabel({ flow, calledFlows: { counter } }, steps, {
				parentStepId: "s2",
				itemId: null,
			}),
		).toEqual({ nodeId: "sub", item: null, flow: "counter" });
	});
});

describe("previewValue", () => {
	test("text as it is, JSON compact, cut short on one line", () => {
		expect(previewValue("two\n lines")).toBe("two lines");
		expect(previewValue({ a: [1, 2] })).toBe('{"a":[1,2]}');
		expect(previewValue("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
	});
});
