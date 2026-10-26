import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "@nightshift/flows";
import { proposalCanvas, summaryLabels } from "./proposal-canvas";

const draft: Flow = flowSchema.parse({
	version: FLOW_VERSION,
	start: "build",
	nodes: [
		{
			id: "build",
			type: "agent",
			position: { x: 0, y: 0 },
			profile: "worker",
			prompt: "Build it.",
		},
		{
			id: "check",
			type: "command",
			position: { x: 300, y: 0 },
			command: "bun test",
		},
		{
			id: "old",
			type: "command",
			position: { x: 600, y: 0 },
			command: "echo old",
		},
	],
	edges: [
		{ id: "e1", from: "build", outcome: "pass", to: "check" },
		{ id: "e2", from: "check", outcome: "pass", to: "old" },
	],
});

/** The draft with a change, on a deep copy. */
function proposed(change: (flow: Flow) => void): Flow {
	const copy = structuredClone(draft);
	change(copy);
	return flowSchema.parse(copy);
}

describe("proposalCanvas", () => {
	test("marks new, removed and changed nodes and edges, and keeps ghosts of removed ones", () => {
		const next = proposed((flow) => {
			flow.nodes = flow.nodes.filter((node) => node.id !== "old");
			flow.edges = flow.edges.filter((edge) => edge.id !== "e2");
			const build = flow.nodes[0];
			if (build?.type === "agent") build.prompt = "Build it well.";
			flow.nodes.push({
				id: "fix",
				type: "command",
				position: { x: 300, y: 200 },
				command: "bun run fix",
			} as Flow["nodes"][number]);
			flow.edges.push({ id: "e3", from: "check", outcome: "fail", to: "fix" });
		});
		const canvas = proposalCanvas(draft, next);
		expect(Object.fromEntries(canvas.nodes)).toEqual({
			build: "changed",
			fix: "added",
			old: "removed",
		});
		expect(Object.fromEntries(canvas.edges)).toEqual({
			e2: "removed",
			e3: "added",
		});
		// The ghosts come after the proposal's own nodes and edges.
		expect(canvas.flow.nodes.map((node) => node.id)).toEqual([
			"build",
			"check",
			"fix",
			"old",
		]);
		expect(canvas.flow.edges.map((edge) => edge.id)).toEqual([
			"e1",
			"e3",
			"e2",
		]);
		expect(canvas.flow.start).toBe("build");
		expect(summaryLabels(canvas.summary)).toEqual([
			"1 new node",
			"1 removed node",
			"1 changed node",
			"2 edge changes",
		]);
	});

	test("a node that only moved has no mark", () => {
		const next = proposed((flow) => {
			const check = flow.nodes[1];
			if (check) check.position = { x: 320, y: 40 };
		});
		const canvas = proposalCanvas(draft, next);
		expect(canvas.nodes.size).toBe(0);
		expect(canvas.edges.size).toBe(0);
		expect(canvas.summary.empty).toBe(true);
		expect(summaryLabels(canvas.summary)).toEqual([]);
	});

	test("an edge the proposal writes again under a new id is not a change", () => {
		const next = proposed((flow) => {
			const first = flow.edges[0];
			if (first) first.id = "renamed";
		});
		const canvas = proposalCanvas(draft, next);
		expect(canvas.edges.size).toBe(0);
		expect(canvas.flow.edges).toHaveLength(2);
	});
});
