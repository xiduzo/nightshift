import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type FlowNode, flowSchema } from "./flow";
import { standInOutcomes, standsIn } from "./node";

const nodes: FlowNode[] = flowSchema.parse({
	version: FLOW_VERSION,
	start: "each",
	nodes: [
		{
			id: "each",
			type: "call",
			position: { x: 0, y: 0 },
			flow: "check-one",
		},
		{
			id: "approve",
			type: "decision",
			position: { x: 0, y: 0 },
			by: "person",
			prompt: "Send it?",
			options: [{ name: "send" }, { name: "hold" }],
		},
		{ id: "done", type: "end", position: { x: 0, y: 0 }, status: "done" },
		{ id: "both", type: "join", position: { x: 0, y: 0 } },
	],
	edges: [],
}).nodes;
const [call, gate, end, join] = nodes as [
	FlowNode,
	FlowNode,
	FlowNode,
	FlowNode,
];

describe("the nodes a test run may pin or skip", () => {
	test("an End and a Join always run", () => {
		expect(standsIn(call)).toBe(true);
		expect(standsIn(gate)).toBe(true);
		expect(standsIn(end)).toBe(false);
		expect(standsIn(join)).toBe(false);
		expect(standsIn({ type: "lease" })).toBe(false);
		expect(standsIn({ type: "service" })).toBe(false);
	});

	test("a stand-in gives one of the node's outcomes, never stopped", () => {
		expect(standInOutcomes(gate)).toEqual(["send", "hold"]);
		expect(standInOutcomes(call)).toEqual(["pass", "fail"]);
	});
});
