import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "../flow";
import {
	nodeOptions,
	removeOutcome,
	renameOutcome,
	withOptions,
} from "./outcomes";

const flow: Flow = flowSchema.parse({
	version: FLOW_VERSION,
	start: "ci",
	nodes: [
		{
			id: "ci",
			type: "wait",
			position: { x: 0, y: 0 },
			until: { kind: "signal", name: "ci-done" },
			outcomes: [
				{ name: "green", when: 'event.body.conclusion = "success"' },
				{ name: "red", when: 'event.body.conclusion = "failure"' },
			],
		},
		{
			id: "fix",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo fix",
		},
	],
	edges: [{ id: "e1", from: "ci", outcome: "red", to: "fix" }],
});

describe("the outcomes of a Wait", () => {
	test("a rename moves the edges on the outcome and keeps its rule", () => {
		const renamed = renameOutcome(flow, "ci", 1, "failed");
		const wait = renamed.nodes.find((node) => node.id === "ci");
		expect(wait?.type === "wait" ? nodeOptions(wait) : []).toEqual([
			{ name: "green", when: 'event.body.conclusion = "success"' },
			{ name: "failed", when: 'event.body.conclusion = "failure"' },
		]);
		expect(renamed.edges[0]?.outcome).toBe("failed");
	});

	test("removing the last outcome leaves a Wait without outcomes, and drops its edges", () => {
		const once = removeOutcome(flow, "ci", 1);
		expect(once.dropped.map((edge) => edge.id)).toEqual(["e1"]);
		const twice = removeOutcome(once.flow, "ci", 0);
		const wait = twice.flow.nodes.find((node) => node.id === "ci");
		expect(wait).not.toHaveProperty("outcomes");
	});

	test("an exit code does not become part of a Wait outcome", () => {
		const wait = flow.nodes[0];
		if (wait?.type !== "wait") throw new Error("not a wait");
		expect(withOptions(wait, [{ name: "green", code: 0 }]).outcomes).toEqual([
			{ name: "green" },
		]);
	});
});
