import { describe, expect, test } from "bun:test";
import { addNode, planSubflowFromSection } from "../draft";
import { FLOW_VERSION, type Flow, flowSchema } from "../flow";
import { validateFlow } from "../validate";
import { endMessage } from "./end";

/** The End node: it ends the run on purpose, with a status and one line. */

function flow(extra: Partial<Flow> = {}): Flow {
	return flowSchema.parse({
		version: FLOW_VERSION,
		inputs: [{ name: "label", type: "text" }],
		start: "look",
		nodes: [
			{
				id: "look",
				type: "command",
				position: { x: 0, y: 0 },
				command: "gh issue list",
			},
			{
				id: "none",
				type: "end",
				position: { x: 300, y: 0 },
				status: "nothing-to-do",
				message: "No open issues for {{label}}",
			},
		],
		edges: [
			{ id: "look-pass-none", from: "look", outcome: "pass", to: "none" },
		],
		...extra,
	});
}

const messages = (f: Flow) => validateFlow(f).map((issue) => issue.message);

describe("the End node", () => {
	test("is valid with a status and a message that reads known names", () => {
		expect(messages(flow())).toEqual([]);
	});

	test("a message that reads an unknown name is an error", () => {
		const f = flow();
		const nodes = f.nodes.map((node) =>
			node.type === "end" ? { ...node, message: "{{ghost}}" } : node,
		);
		expect(messages({ ...f, nodes })).toContainEqual(
			expect.stringContaining('The message of "none" uses {{ghost}}'),
		);
	});

	test("no edge can leave it", () => {
		const f = flow();
		const issues = validateFlow({
			...f,
			edges: [
				...f.edges,
				{ id: "none-done-look", from: "none", outcome: "done", to: "look" },
			],
		});
		expect(issues).toContainEqual({
			severity: "error",
			message:
				'Edge "none-done-look" leaves the End node "none". An End node ends the run, so no edge can leave it.',
			edgeId: "none-done-look",
		});
	});

	test("takes only a known status", () => {
		expect(() =>
			flowSchema.parse({
				version: FLOW_VERSION,
				start: "x",
				nodes: [
					{ id: "x", type: "end", position: { x: 0, y: 0 }, status: "ok" },
				],
				edges: [],
			}),
		).toThrow();
	});

	test("the palette adds one that ends the run as done", () => {
		const { flow: next, id } = addNode(flow(), "end", { x: 0, y: 0 });
		expect(next.nodes.find((node) => node.id === id)).toEqual({
			id: "end",
			type: "end",
			position: { x: 0, y: 0 },
			status: "done",
			message: "",
		});
	});

	test("a Section with an End node does not become a Subflow", () => {
		const f = flow({
			sections: [{ id: "s", label: "Look", nodes: ["look", "none"] }],
		});
		const plan = planSubflowFromSection(f, "s", {
			name: "look",
			existingFlowNames: ["main"],
		});
		expect(plan.ok).toBe(false);
		if (!plan.ok) {
			expect(plan.blockers).toContainEqual({
				code: "end-node",
				nodes: ["none"],
			});
		}
	});
});

describe("endMessage", () => {
	test("is the first line that is not blank, trimmed", () => {
		expect(endMessage("\n  No open issues  \nmore")).toBe("No open issues");
	});

	test("is null for a blank message", () => {
		expect(endMessage("  \n ")).toBeNull();
	});
});
