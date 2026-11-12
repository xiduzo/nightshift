import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "@nightshift/flows";
import type { NodeSample } from "./samples";
import { nodeSamples, pinnedSamples, pinProblem } from "./samples";
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

describe("the outputs a test run pins", () => {
	const runs = [
		run("old", 100, [
			step("s1", "fetch", { outputs: { data: { items: ["old"] } } }),
			step("s2", "pick", { outputs: { data: "old" } }),
		]),
		run("new", 200, [
			step("s3", "fetch", { outputs: { data: { items: ["new"] } } }),
		]),
	];

	test("each pin gives the step it names, not the newest", () => {
		const samples = pinnedSamples(
			runs,
			{
				fetch: { runId: "old", stepId: "s1" },
				pick: { runId: "old", stepId: "s2" },
			},
			flow,
		);
		expect(samples.get("fetch")).toEqual({
			runId: "old",
			stepId: "s1",
			endedAt: 1,
			outcome: "pass",
			outputs: { data: { items: ["old"] } },
			inputs: { topic: "old" },
			changed: false,
		});
		expect(samples.get("pick")?.outputs).toEqual({ data: "old" });
	});

	test("a pin whose run, step or node is gone gives nothing", () => {
		const samples = pinnedSamples(
			runs,
			{
				fetch: { runId: "gone", stepId: "s1" },
				pick: { runId: "new", stepId: "s9" },
				gone: { runId: "old", stepId: "s1" },
			},
			flow,
		);
		expect(samples.size).toBe(0);
	});

	test("a pinned step keeps its mark", () => {
		const samples = pinnedSamples(
			[run("test", 300, [step("s4", "fetch", { test: "pinned" })])],
			{ fetch: { runId: "test", stepId: "s4" } },
			flow,
		);
		expect(samples.get("fetch")?.test).toBe("pinned");
	});
});

describe("whether a test run can pin a node's output", () => {
	const [fetch, , done] = flow.nodes as [
		Flow["nodes"][number],
		Flow["nodes"][number],
		Flow["nodes"][number],
	];
	const sample = (fields: Partial<NodeSample> = {}): NodeSample => ({
		runId: "r",
		stepId: "s",
		endedAt: 1,
		outcome: "pass",
		outputs: {},
		inputs: {},
		changed: false,
		...fields,
	});

	test("a step that ended on one of the node's outcomes", () => {
		expect(pinProblem(fetch, sample())).toBeNull();
		expect(pinProblem(fetch, sample({ test: "pinned" }))).toBeNull();
	});

	test("no step, a step that runs, a skipped step", () => {
		expect(pinProblem(fetch, undefined)).toBe(
			"Run the flow first. Then pin its output.",
		);
		expect(pinProblem(fetch, sample({ endedAt: null }))).toBe(
			"Its step runs now.",
		);
		expect(pinProblem(fetch, sample({ test: "skipped" }))).toBe(
			"It was skipped in that run.",
		);
	});

	test("a step that did not finish, or an outcome the node lost", () => {
		expect(pinProblem(fetch, sample({ outcome: "error" }))).toBe(
			"Its step did not finish in that run.",
		);
		expect(pinProblem(fetch, sample({ outcome: "retry" }))).toBe(
			'It has no outcome "retry" now.',
		);
	});

	test("an End always runs", () => {
		expect(pinProblem(done, sample())).toBe(
			"A test run always runs this node.",
		);
	});
});
