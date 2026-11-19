import { describe, expect, test } from "bun:test";
import type { AgentNode, Flow, FlowNode } from "@nightshift/flows";
import {
	NO_BRANCHES,
	preparedRun,
	quickRunTitle,
	refuseBaseOfRunFolder,
	refuseDevice,
} from "./prepared-run";
import type { Works } from "./service-devices";

/**
 * What a planned run starts with, and the checks of the start before
 * anything is written: the base of a run folder, each Device, the stop
 * time, the inputs and the title.
 */

const node = (fields: Record<string, unknown>): FlowNode =>
	fields as unknown as FlowNode;

const agent = (id: string, fields: Record<string, unknown> = {}) =>
	node({ id, type: "agent", prompt: "work", ...fields }) as AgentNode;

const flowOf = (nodes: FlowNode[], inputs: Flow["inputs"] = []): Flow =>
	({
		version: 2,
		start: nodes[0]?.id ?? "a",
		nodes,
		edges: [],
		inputs,
	}) as unknown as Flow;

/** An Agent works in the worktree, a Gate on no computer. */
const works: Works = (n) => (n.type === "agent" ? "worktree" : null);

describe("quickRunTitle", () => {
	test("is the first Agent prompt, whitespace folded", () => {
		expect(
			quickRunTitle(flowOf([agent("a", { prompt: "  fix\n the   bug " })])),
		).toBe("fix the bug");
	});

	test("falls back when no Agent node has a prompt", () => {
		expect(quickRunTitle(flowOf([node({ id: "c", type: "command" })]))).toBe(
			"Quick run",
		);
	});

	test("cuts a long prompt at 80 characters with an ellipsis", () => {
		const title = quickRunTitle(
			flowOf([agent("a", { prompt: "x".repeat(100) })]),
		);
		expect(title).toHaveLength(80);
		expect(title.endsWith("…")).toBe(true);
	});
});

describe("refuseBaseOfRunFolder", () => {
	test("refuses a base for a run of a project without a folder, and only then", () => {
		expect(() => refuseBaseOfRunFolder({ baseRef: "main" }, true)).toThrow(
			NO_BRANCHES,
		);
		expect(() => refuseBaseOfRunFolder({}, true)).not.toThrow();
		expect(() =>
			refuseBaseOfRunFolder({ baseRef: "main" }, false),
		).not.toThrow();
	});
});

describe("refuseDevice", () => {
	const laptop = { name: "Laptop", hasClone: true };
	test("refuses with the requirement the Device misfits", () => {
		expect(() =>
			refuseDevice(
				{ at: laptop, nodes: [agent("a")] },
				"Add it under Agents.",
				works,
			),
		).toThrow("Add it under Agents.");
	});

	test("refuses a Device without the project for a node that works in the worktree", () => {
		expect(() =>
			refuseDevice(
				{ at: { name: "Laptop", hasClone: false }, nodes: [agent("fix")] },
				null,
				works,
			),
		).toThrow(
			'The flow runs node "fix" on Laptop, but that device does not have this project. Add its folder there first.',
		);
		expect(() =>
			refuseDevice(
				{
					at: { name: "Laptop", hasClone: false },
					nodes: [node({ id: "ship", type: "decision" })],
				},
				null,
				works,
			),
		).not.toThrow();
	});
});

describe("preparedRun", () => {
	const planned = (flow: Flow, flowName: string | null = "nightly") => ({
		flow,
		flowName,
		flowRevision: null,
		calledFlows: {},
		calledFlowRevisions: {},
		groups: [{ at: { id: "here", name: "Here" }, nodes: flow.nodes }],
	});
	const facts = (now = 1_000, runFolder = false) => ({
		now,
		runFolder,
		works,
		resolve: (
			declared: NonNullable<Flow["inputs"]>,
			given: Record<string, unknown> | undefined,
		) =>
			Object.fromEntries(declared.map((d) => [d.name, given?.[d.name] ?? ""])),
	});

	test("refuses a stop time that has passed", () => {
		const flow = flowOf([agent("a")]);
		expect(() =>
			preparedRun({ stopAt: 1_000 }, planned(flow), facts(1_000)),
		).toThrow("The stop time has passed already.");
		expect(
			preparedRun({ stopAt: 1_001 }, planned(flow), facts(1_000)).stopAt,
		).toBe(1_001);
		expect(preparedRun({}, planned(flow), facts()).stopAt).toBeNull();
	});

	test("titles a flow file with its name and its text inputs, and a quick run with its prompt", () => {
		const flow = flowOf([agent("a", { prompt: "Find leads" })], [
			{ name: "topic", type: "text" },
			{ name: "count", type: "number" },
			{ name: "empty" },
		] as Flow["inputs"]);
		const run = preparedRun(
			{ inputs: { topic: "bikes", count: 3 } },
			planned(flow),
			facts(),
		);
		expect(run.title).toBe("nightly · topic bikes");
		expect(run.inputs).toEqual({ topic: "bikes", count: 3, empty: "" });
		expect(preparedRun({}, planned(flow, null), facts()).title).toBe(
			"Find leads",
		);
	});

	test("notes the folders of a run whose folder steps sit on more than one Device", () => {
		const a = agent("a");
		const b = agent("b");
		const flow = flowOf([a, b]);
		const split = {
			...planned(flow),
			groups: [
				{ at: { id: "mac", name: "MacBook" }, nodes: [a] },
				{ at: { id: "box", name: "hetzner-1" }, nodes: [b] },
			],
		};
		expect(preparedRun({}, split, facts(1_000, true)).notes).toEqual([
			"The steps of this run work in folders on MacBook and hetzner-1. Each device has its own folder, so the files of one are not on the other.",
		]);
		expect(preparedRun({}, split, facts(1_000, false)).notes).toEqual([]);
		expect(preparedRun({}, planned(flow), facts(1_000, true)).notes).toEqual(
			[],
		);
	});
});
