import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "@nightshift/flows";
import { nodeSamples } from "./samples";
import type { RunDetail, StepSummary } from "./types";

const flow: Flow = flowSchema.parse({
	version: FLOW_VERSION,
	start: "fetch",
	nodes: [
		{
			id: "fetch",
			type: "command",
			position: { x: 0, y: 0 },
			command: "curl -s https://example.com/feed",
			stdout: "json",
		},
		{
			id: "pick",
			type: "value",
			position: { x: 300, y: 0 },
			by: "rule",
			expression: "fetch.data.items[0]",
			output: { type: "string" },
		},
		{
			id: "done",
			type: "end",
			position: { x: 600, y: 0 },
			status: "done",
		},
	],
	edges: [],
});

function step(
	id: string,
	nodeId: string,
	fields: Partial<StepSummary> = {},
): StepSummary {
	return {
		id,
		nodeId,
		nodeType: flow.nodes.find((node) => node.id === nodeId)?.type ?? "value",
		visit: 1,
		startedAt: 0,
		endedAt: 1,
		outcome: "pass",
		outputs: { outcome: "pass" },
		scope: null,
		...fields,
	} as StepSummary;
}

function run(
	id: string,
	createdAt: number,
	steps: StepSummary[],
	fields: Partial<RunDetail> = {},
) {
	return {
		id,
		createdAt,
		flow,
		inputs: { topic: id },
		steps,
		...fields,
	};
}

describe("the newest sample of each node", () => {
	test("a node's sample is its newest visit in the newest run", () => {
		const samples = nodeSamples(
			[
				run("old", 100, [
					step("s1", "fetch", { outputs: { data: { items: ["old"] } } }),
				]),
				run("new", 200, [
					step("s2", "fetch", {
						startedAt: 10,
						outputs: { data: { items: ["first"] } },
					}),
					step("s3", "fetch", {
						startedAt: 20,
						visit: 2,
						endedAt: null,
						outcome: null,
						outputs: {},
					}),
				]),
			],
			flow,
		);
		expect(samples.get("fetch")).toEqual({
			runId: "new",
			stepId: "s3",
			endedAt: null,
			outcome: null,
			outputs: {},
			inputs: { topic: "new" },
			changed: false,
		});
	});

	test("a step inside a called flow or an item does not count", () => {
		const samples = nodeSamples(
			[
				run("one", 100, [
					step("s1", "pick", {
						scope: { parentStepId: "call", itemId: null },
					}),
				]),
			],
			flow,
		);
		expect(samples.has("pick")).toBe(false);
	});

	test("a step of another node type does not count", () => {
		const samples = nodeSamples(
			[run("one", 100, [step("s1", "pick", { nodeType: "agent" })])],
			flow,
		);
		expect(samples.has("pick")).toBe(false);
	});

	test("a node the newest run did not reach takes an older run's step", () => {
		const samples = nodeSamples(
			[
				run("new", 300, [step("s3", "fetch")]),
				run("old", 100, [step("s1", "pick", { outputs: { data: "x" } })]),
			],
			flow,
		);
		expect(samples.get("fetch")?.runId).toBe("new");
		expect(samples.get("pick")).toMatchObject({
			runId: "old",
			stepId: "s1",
			outputs: { data: "x" },
			inputs: { topic: "old" },
		});
		expect(samples.has("done")).toBe(false);
	});

	test("a node changed since its run, and a move alone is no change", () => {
		const ranFlow: Flow = {
			...flow,
			nodes: flow.nodes.map((node) =>
				node.id === "pick" && node.type === "value"
					? { ...node, expression: "fetch.data.items[1]" }
					: { ...node, position: { x: 999, y: 999 } },
			),
		};
		const samples = nodeSamples(
			[
				run("one", 100, [step("s1", "fetch"), step("s2", "pick")], {
					flow: ranFlow,
				}),
			],
			flow,
		);
		expect(samples.get("fetch")?.changed).toBe(false);
		expect(samples.get("pick")?.changed).toBe(true);
	});

	test("a node that the run's flow does not have counts as changed", () => {
		const samples = nodeSamples(
			[
				run("one", 100, [step("s1", "fetch")], {
					flow: { ...flow, nodes: [] },
				}),
			],
			flow,
		);
		expect(samples.get("fetch")?.changed).toBe(true);
	});
});
