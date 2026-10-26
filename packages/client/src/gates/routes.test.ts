import { describe, expect, test } from "bun:test";

import type { RunDetail } from "../runs";
import { choiceRoutes } from "./routes";

/** A run whose flow has a Gate `review`: approve goes to `build`, reject ends, retry loops back once. */
function run(fields: Partial<RunDetail> = {}): RunDetail {
	return {
		flow: {
			nodes: [{ id: "plan" }, { id: "review" }, { id: "build" }],
			edges: [
				{ id: "e1", from: "review", outcome: "approve", to: "build" },
				{ id: "e2", from: "review", outcome: "retry", to: "plan", max: 1 },
			],
		},
		traversals: {},
		steps: [{ id: "s2", nodeId: "review", scope: null }],
		...fields,
	} as unknown as RunDetail;
}

const labels = new Map([
	["plan", "Plan"],
	["build", "Build it"],
]);
const choices = [{ name: "approve" }, { name: "reject" }, { name: "retry" }];
const gate = { stepId: "s2", nodeId: "review" };

describe("choiceRoutes", () => {
	test("each choice leads where the flow's edges say", () => {
		const routes = choiceRoutes(run(), gate, choices, labels);
		expect(routes.get("approve")).toEqual({
			kind: "node",
			nodeId: "build",
			label: "Build it",
		});
		expect(routes.get("reject")).toEqual({ kind: "end" });
		expect(routes.get("retry")).toEqual({
			kind: "node",
			nodeId: "plan",
			label: "Plan",
		});
	});

	test("a path the run took its most times stops the run", () => {
		const routes = choiceRoutes(
			run({ traversals: { e2: 1 } }),
			gate,
			choices,
			labels,
		);
		expect(routes.get("retry")).toEqual({ kind: "limit" });
	});

	test("an Agent that asks: the answer goes back to it, stop takes its fail edge", () => {
		const asks = run({
			flow: {
				nodes: [{ id: "build", type: "agent" }, { id: "plan" }],
				edges: [{ id: "e1", from: "build", outcome: "fail", to: "plan" }],
			},
			steps: [{ id: "s1", nodeId: "build", scope: null }],
		} as unknown as Partial<RunDetail>);
		const routes = choiceRoutes(
			asks,
			{ stepId: "s1", nodeId: "build" },
			[{ name: "answer", needsNote: true }, { name: "stop" }],
			labels,
		);
		expect(routes.has("answer")).toBe(false);
		expect(routes.get("stop")).toEqual({
			kind: "node",
			nodeId: "plan",
			label: "Plan",
		});
	});

	test("a node without a label goes by its id", () => {
		const routes = choiceRoutes(run(), gate, [{ name: "approve" }], new Map());
		expect(routes.get("approve")).toMatchObject({ label: "build" });
	});

	test("nothing while the run loads, or for a Gate in a called flow", () => {
		expect(choiceRoutes(undefined, gate, choices, labels).size).toBe(0);
		const called = run({
			steps: [
				{
					id: "s9",
					nodeId: "review",
					scope: { parentStepId: "s1", itemId: null },
				},
			] as unknown as RunDetail["steps"],
		});
		expect(
			choiceRoutes(called, { stepId: "s9", nodeId: "review" }, choices, labels)
				.size,
		).toBe(0);
		expect(
			choiceRoutes(
				run(),
				{ stepId: "s3", nodeId: "elsewhere" },
				choices,
				labels,
			).size,
		).toBe(0);
	});
});
