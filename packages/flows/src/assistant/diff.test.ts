import { describe, expect, test } from "bun:test";
import { type Flow, type FlowInput, flowSchema } from "../document";
import { diffFlows, flowDiffSummary } from "./diff";

const base: FlowInput = {
	version: 7,
	description: "Builds and checks.",
	inputs: [{ name: "task", type: "text" }],
	outputs: [{ name: "summary", value: "{{build.summary}}" }],
	variables: [{ name: "tries", type: "number", initial: "0" }],
	start: "build",
	nodes: [
		{
			id: "build",
			type: "agent",
			position: { x: 0, y: 0 },
			profile: "worker",
			prompt: "Do {{task}}.",
		},
		{
			id: "check",
			type: "command",
			position: { x: 300, y: 0 },
			command: "bun test",
		},
	],
	edges: [
		{ id: "e1", from: "build", outcome: "pass", to: "check" },
		{ id: "e2", from: "check", outcome: "fail", to: "build", max: 3 },
	],
	sections: [{ id: "s1", label: "Work", nodes: ["build", "check"] }],
};

const parse = (flow: FlowInput): Flow => flowSchema.parse(flow);

/** `base` with a change, made on a deep copy. */
function edit(change: (flow: FlowInput) => void): Flow {
	const copy = structuredClone(base);
	change(copy);
	return parse(copy);
}

const nodeAt = (flow: FlowInput, id: string) => {
	const node = flow.nodes.find((n) => n.id === id);
	if (!node) throw new Error(id);
	return node;
};

describe("diffFlows", () => {
	test("the same flow has no changes", () => {
		const diff = diffFlows(parse(base), parse(structuredClone(base)));
		expect(diff.nodes).toEqual({
			added: [],
			removed: [],
			changed: [],
			moved: [],
		});
		expect(diff.edges).toEqual({ added: [], removed: [], changed: [] });
		expect(diff.flow).toEqual([]);
		expect(flowDiffSummary(diff).empty).toBe(true);
	});

	test("key order and left-out keys set to undefined are no change", () => {
		const after = parse(base);
		const node = after.nodes[0];
		if (node?.type !== "agent") throw new Error("agent");
		const { prompt, ...rest } = node;
		after.nodes[0] = { ...rest, skill: undefined, prompt };
		expect(flowDiffSummary(diffFlows(parse(base), after)).empty).toBe(true);
	});

	test("added and removed nodes, by id", () => {
		const after = edit((flow) => {
			flow.nodes = flow.nodes.filter((n) => n.id !== "check");
			flow.nodes.push({
				id: "review",
				type: "decision",
				position: { x: 600, y: 0 },
				prompt: "Ship it?",
				by: "person",
				options: [{ name: "yes" }, { name: "no" }],
			});
		});
		const diff = diffFlows(parse(base), after);
		expect(diff.nodes.added.map((n) => n.id)).toEqual(["review"]);
		expect(diff.nodes.removed.map((n) => n.id)).toEqual(["check"]);
		expect(diff.nodes.changed).toEqual([]);
	});

	test("a changed node names the fields that differ", () => {
		const after = edit((flow) => {
			const build = nodeAt(flow, "build");
			if (build.type !== "agent") throw new Error("agent");
			build.prompt = "Do {{task}} well.";
			build.label = "Build";
			build.outcomes = [{ name: "done" }];
			build.output = { type: "object", properties: {} };
			build.set = [{ variable: "tries", expression: "vars.tries + 1" }];
		});
		const [change, ...rest] = diffFlows(parse(base), after).nodes.changed;
		expect(rest).toEqual([]);
		expect(change?.id).toBe("build");
		expect(change?.fields).toEqual([
			"label",
			"outcomes",
			"output",
			"prompt",
			"set",
		]);
		expect(change?.moved).toBe(false);
	});

	test("a node that only moved is in moved, not in changed", () => {
		const after = edit((flow) => {
			nodeAt(flow, "check").position = { x: 300, y: 200 };
		});
		const diff = diffFlows(parse(base), after);
		expect(diff.nodes.changed).toEqual([]);
		expect(diff.nodes.moved).toEqual([
			{ id: "check", before: { x: 300, y: 0 }, after: { x: 300, y: 200 } },
		]);
		const summary = flowDiffSummary(diff);
		expect(summary.moved).toBe(1);
		expect(summary.empty).toBe(true);
	});

	test("a node that moved and changed is changed, marked as moved", () => {
		const after = edit((flow) => {
			const check = nodeAt(flow, "check");
			if (check.type !== "command") throw new Error("command");
			check.position = { x: 0, y: 200 };
			check.command = "bun test --bail";
		});
		const diff = diffFlows(parse(base), after);
		expect(diff.nodes.moved).toEqual([]);
		expect(diff.nodes.changed[0]?.fields).toEqual(["command"]);
		expect(diff.nodes.changed[0]?.moved).toBe(true);
	});

	test("a node with the same id and another type changes its type", () => {
		const after = edit((flow) => {
			flow.nodes[1] = {
				id: "check",
				type: "wait",
				position: { x: 300, y: 0 },
				until: { kind: "duration", minutes: 5 },
			};
			flow.edges = [];
		});
		const fields = diffFlows(parse(base), after).nodes.changed[0]?.fields;
		expect(fields).toContain("type");
		expect(fields).toContain("until");
		expect(fields).toContain("command");
	});

	test("edges: added, removed and changed by id", () => {
		const after = edit((flow) => {
			flow.edges = [
				{ id: "e2", from: "check", outcome: "fail", to: "build", max: 5 },
				{ id: "e3", from: "build", outcome: "fail", to: "check" },
			];
		});
		const diff = diffFlows(parse(base), after);
		expect(diff.edges.added.map((e) => e.id)).toEqual(["e3"]);
		expect(diff.edges.removed.map((e) => e.id)).toEqual(["e1"]);
		expect(diff.edges.changed).toEqual([
			{
				before: {
					id: "e2",
					from: "check",
					outcome: "fail",
					to: "build",
					max: 3,
				},
				after: {
					id: "e2",
					from: "check",
					outcome: "fail",
					to: "build",
					max: 5,
				},
				fields: ["max"],
			},
		]);
	});

	test("an edge under a new id with the same ends is the same edge", () => {
		const after = edit((flow) => {
			flow.edges = [
				{ id: "build-pass-check", from: "build", outcome: "pass", to: "check" },
				{ id: "check-fail-build", from: "check", outcome: "fail", to: "build" },
			];
		});
		const diff = diffFlows(parse(base), after);
		expect(diff.edges.added).toEqual([]);
		expect(diff.edges.removed).toEqual([]);
		expect(diff.edges.changed.map((c) => [c.before.id, c.after.id])).toEqual([
			["e2", "check-fail-build"],
		]);
		expect(diff.edges.changed[0]?.fields).toEqual(["max"]);
	});

	test("an edge that keeps its id but changes its target is changed", () => {
		const after = edit((flow) => {
			const edge = flow.edges[0];
			if (edge) edge.outcome = "fail";
		});
		expect(diffFlows(parse(base), after).edges.changed[0]?.fields).toEqual([
			"outcome",
		]);
	});

	test("inputs, outputs and variables by name", () => {
		const after = edit((flow) => {
			flow.inputs = [
				{ name: "task", type: "text", required: true },
				{ name: "repo", type: "text" },
			];
			flow.outputs = [];
			flow.variables = [
				{ name: "tries", type: "number", initial: "1" },
				{ name: "notes", type: "text" },
			];
		});
		const diff = diffFlows(parse(base), after);
		expect(diff.inputs.added.map((i) => i.name)).toEqual(["repo"]);
		expect(diff.inputs.changed[0]?.fields).toEqual(["required"]);
		expect(diff.outputs.removed.map((o) => o.name)).toEqual(["summary"]);
		expect(diff.variables.added.map((v) => v.name)).toEqual(["notes"]);
		expect(diff.variables.changed[0]?.fields).toEqual(["initial"]);
	});

	test("a flow without variables or Sections equals one with empty lists", () => {
		const after = edit((flow) => {
			flow.variables = undefined;
			flow.sections = undefined;
		});
		const before = edit((flow) => {
			flow.variables = [];
			flow.sections = [];
		});
		expect(flowDiffSummary(diffFlows(before, after)).empty).toBe(true);
	});

	test("Sections by id", () => {
		const after = edit((flow) => {
			flow.sections = [
				{ id: "s1", label: "Work", color: "blue", nodes: ["build"] },
				{ id: "s2", label: "Check", nodes: ["check"] },
			];
		});
		const diff = diffFlows(parse(base), after);
		expect(diff.sections.added.map((s) => s.id)).toEqual(["s2"]);
		expect(diff.sections.changed[0]?.fields).toEqual(["color", "nodes"]);
	});

	test("the flow's own fields", () => {
		const after = edit((flow) => {
			flow.start = "check";
			flow.description = undefined;
			flow.policy = { maxSteps: 50 };
		});
		expect(diffFlows(parse(base), after).flow).toEqual([
			"description",
			"policy",
			"start",
		]);
	});
});

describe("flowDiffSummary", () => {
	test("counts steps, edges and the rest", () => {
		const after = edit((flow) => {
			flow.nodes.push(
				{
					id: "wait",
					type: "wait",
					position: { x: 0, y: 300 },
					until: { kind: "duration", minutes: 1 },
				},
				{
					id: "ask",
					type: "decision",
					position: { x: 0, y: 600 },
					by: "person",
					prompt: "Go?",
					options: [{ name: "yes" }],
				},
			);
			const check = nodeAt(flow, "check");
			if (check.type === "command") check.command = "bun test --bail";
			nodeAt(flow, "build").position = { x: 10, y: 10 };
			flow.edges.push({ id: "e3", from: "build", outcome: "fail", to: "wait" });
			flow.inputs = [];
		});
		expect(flowDiffSummary(diffFlows(parse(base), after))).toEqual({
			added: 2,
			removed: 0,
			changed: 1,
			moved: 1,
			edges: 1,
			other: 1,
			empty: false,
		});
	});
});
