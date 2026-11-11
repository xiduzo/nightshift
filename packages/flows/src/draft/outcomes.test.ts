import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "../flow";
import {
	nodeOptions,
	removeOutcome,
	renameOutcome,
	restoreOutcome,
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

describe("the options of a Decision", () => {
	const gate: Flow = flowSchema.parse({
		version: FLOW_VERSION,
		start: "ship",
		nodes: [
			{
				id: "ship",
				type: "decision",
				position: { x: 0, y: 0 },
				prompt: "Ship it?",
				by: "person",
				options: [{ name: "approve" }, { name: "reject" }],
				recommend: { option: "approve", reason: "The checks pass." },
				deadline: { at: "07:00", choose: "approve" },
			},
			{
				id: "pick",
				type: "decision",
				position: { x: 0, y: 0 },
				prompt: "Which fix?",
				by: "model",
				options: [{ name: "small" }, { name: "large" }],
				cascade: [
					{ minConfidence: 0.8 },
					{
						person: true,
						recommend: { option: "small" },
						deadline: { minutes: 30, choose: "small" },
					},
				],
			},
			{
				id: "templated",
				type: "decision",
				position: { x: 0, y: 0 },
				prompt: "Ship it?",
				by: "person",
				options: [{ name: "approve" }, { name: "reject" }],
				recommend: { option: "{{triage.data.pick}}" },
			},
		],
		edges: [],
	});
	const decision = (from: Flow, id: string) => {
		const node = from.nodes.find((candidate) => candidate.id === id);
		if (node?.type !== "decision") throw new Error("not a decision");
		return node;
	};

	test("a rename moves the recommendation and the deadline that name the option", () => {
		const ship = decision(renameOutcome(gate, "ship", 0, "go"), "ship");
		expect(ship.recommend).toEqual({
			option: "go",
			reason: "The checks pass.",
		});
		expect(ship.deadline).toEqual({ at: "07:00", choose: "go" });
	});

	test("a rename of another option leaves them as they are", () => {
		const ship = decision(renameOutcome(gate, "ship", 1, "stop"), "ship");
		expect(ship.recommend?.option).toBe("approve");
		expect(ship.deadline?.choose).toBe("approve");
	});

	test("a rename moves the recommendation and the deadline of the person tier", () => {
		const pick = decision(renameOutcome(gate, "pick", 0, "tiny"), "pick");
		expect(pick.cascade?.[1]).toEqual({
			person: true,
			recommend: { option: "tiny" },
			deadline: { minutes: 30, choose: "tiny" },
		});
		expect(pick.cascade?.[0]).toEqual(decision(gate, "pick").cascade?.[0]);
	});

	test("a rename leaves a template recommendation as it is", () => {
		const templated = decision(
			renameOutcome(gate, "templated", 0, "go"),
			"templated",
		);
		expect(templated.recommend).toEqual({ option: "{{triage.data.pick}}" });
	});

	test("removing the option clears the recommendation that names it, and an undo puts it back", () => {
		const removed = removeOutcome(gate, "ship", 0);
		expect(decision(removed.flow, "ship")).not.toHaveProperty("recommend");
		expect(removed.cleared).toEqual([
			{
				tier: null,
				recommend: { option: "approve", reason: "The checks pass." },
			},
		]);
		const back = restoreOutcome(
			removed.flow,
			"ship",
			0,
			removed.option ?? { name: "approve" },
			removed.dropped,
			removed.cleared,
		);
		expect(decision(back, "ship").recommend).toEqual(
			decision(gate, "ship").recommend,
		);
	});

	test("removing the option clears the recommendation of the person tier", () => {
		const removed = removeOutcome(gate, "pick", 0);
		expect(decision(removed.flow, "pick").cascade?.[1]).not.toHaveProperty(
			"recommend",
		);
		expect(removed.cleared).toEqual([
			{ tier: 1, recommend: { option: "small" } },
		]);
	});

	test("removing another option keeps the recommendation", () => {
		const removed = removeOutcome(gate, "ship", 1);
		expect(decision(removed.flow, "ship").recommend?.option).toBe("approve");
		expect(removed.cleared).toEqual([]);
	});
});
