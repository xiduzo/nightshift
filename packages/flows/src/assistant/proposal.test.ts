import { describe, expect, test } from "bun:test";
import { type Flow, type FlowInput, flowSchema } from "../document";
import type { FlowIssue } from "../validate";
import { proposalIssues } from "./proposal";

const valid: FlowInput = {
	version: 7,
	inputs: [{ name: "task", type: "text" }],
	start: "build",
	nodes: [
		{
			id: "build",
			type: "agent",
			position: { x: 0, y: 0 },
			profile: { device: "mac", profile: "worker" },
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
};

const draft: Flow = flowSchema.parse({
	version: 7,
	start: "only",
	nodes: [
		{
			id: "only",
			type: "agent",
			position: { x: 0, y: 0 },
			profile: { device: "mac", profile: "old" },
			connections: ["jira"],
			prompt: "Hi.",
		},
	],
	edges: [],
});

const errors = (issues: FlowIssue[]) =>
	issues.filter((issue) => issue.severity === "error");

describe("proposalIssues", () => {
	test("a valid flow has no errors", () => {
		expect(errors(proposalIssues(draft, structuredClone(valid)))).toEqual([]);
	});

	test("not an object, or another version", () => {
		for (const proposal of [null, "flow", { ...valid, version: 4 }, {}]) {
			const issues = proposalIssues(draft, proposal);
			expect(issues).toHaveLength(1);
			expect(issues[0]?.message).toContain('"version": 7');
		}
	});

	test("a schema issue lands on its node or edge", () => {
		const proposal = structuredClone(valid);
		const check = proposal.nodes[1];
		if (check?.type !== "command") throw new Error("command");
		(check as { command?: string }).command = undefined;
		const edge = proposal.edges[0];
		if (edge) edge.outcome = "Not A Label";
		const issues = proposalIssues(draft, proposal);
		expect(issues.find((i) => i.nodeId === "check")?.message).toStartWith(
			'Node "check": command: ',
		);
		expect(issues.find((i) => i.edgeId === "e1")?.message).toStartWith(
			'Edge "e1": outcome: ',
		);
	});

	test("a schema issue outside a node names its path", () => {
		const proposal = { ...structuredClone(valid), start: "Bad Start" };
		const [issue] = proposalIssues(draft, proposal);
		expect(issue?.message).toStartWith("start: ");
		expect(issue?.nodeId).toBeUndefined();
	});

	test("the meaning of the flow: a loop without a max", () => {
		const proposal = structuredClone(valid);
		const loop = proposal.edges[1];
		if (loop) loop.max = undefined;
		const found = errors(proposalIssues(draft, proposal));
		expect(found.length).toBeGreaterThan(0);
	});

	test("a profile or connection this computer does not have", () => {
		const proposal = structuredClone(valid);
		const build = proposal.nodes[0];
		if (build?.type !== "agent") throw new Error("agent");
		build.connections = ["github", "made_up"];
		const issues = errors(
			proposalIssues(draft, proposal, {
				profiles: [{ device: "mac", profile: "reviewer" }],
				connections: ["github"],
			}),
		);
		expect(issues.map((i) => [i.nodeId, i.message])).toEqual([
			[
				"build",
				'This computer has no connection "made_up". Use one it has, or leave it out.',
			],
			[
				"build",
				'There is no profile "worker" on the device "mac". Use a device and a profile from list_profiles.',
			],
		]);
	});

	test("a profile or connection the draft already names is left to the editor", () => {
		const proposal = structuredClone(valid);
		const build = proposal.nodes[0];
		if (build?.type !== "agent") throw new Error("agent");
		build.profile = { device: "mac", profile: "old" };
		build.connections = ["jira"];
		expect(
			errors(
				proposalIssues(draft, proposal, { profiles: [], connections: [] }),
			),
		).toEqual([]);
	});

	test("a Call node checks the flows of the project", () => {
		const proposal: FlowInput = {
			version: 7,
			start: "sub",
			nodes: [
				{
					id: "sub",
					type: "call",
					position: { x: 0, y: 0 },
					flow: "missing",
				},
			],
			edges: [],
		};
		expect(errors(proposalIssues(draft, proposal))).toEqual([]);
		const issues = errors(proposalIssues(draft, proposal, { flows: {} }));
		expect(issues[0]?.nodeId).toBe("sub");
	});

	test("a flow that calls itself, by its own name", () => {
		const proposal: FlowInput = {
			version: 7,
			start: "again",
			nodes: [
				{ id: "again", type: "call", position: { x: 0, y: 0 }, flow: "me" },
			],
			edges: [],
		};
		const issues = errors(
			proposalIssues(draft, proposal, { flows: { me: draft }, name: "me" }),
		);
		expect(issues.length).toBeGreaterThan(0);
	});
});
