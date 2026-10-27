import { describe, expect, test } from "bun:test";
import type { Flow, FlowNode } from "@nightshift/flows";
import { flowsForRun } from "./run-flows";

const flowOf = (calls: string[]): Flow => ({
	version: 6,
	inputs: [],
	outputs: [],
	start: calls.length > 0 ? "call_0" : "hello",
	nodes:
		calls.length > 0
			? calls.map(
					(flow, index) =>
						({
							id: `call_${index}`,
							type: "call",
							position: { x: 0, y: 0 },
							flow,
							inputs: flow.startsWith("kit:") ? { name: "a-branch" } : {},
						}) as FlowNode,
				)
			: [
					{
						id: "hello",
						type: "command",
						position: { x: 0, y: 0 },
						command: "echo hello",
						output: "text",
					},
				],
	edges: [],
});

describe("flowsForRun: the Flow revisions", () => {
	test("gives the revision of the flow and of each called flow that has one; a kit has none", () => {
		const loaded = flowsForRun(
			{
				build: {
					json: flowOf(["saved", "draft", "kit:github/create-branch"]),
					revision: "rev-build",
				},
				saved: { json: flowOf([]), revision: "rev-saved" },
				draft: { json: flowOf([]) },
			},
			{ projectId: "project", flowName: "build" },
		);
		expect(loaded.flowRevision).toBe("rev-build");
		expect(loaded.calledFlowRevisions).toEqual({ saved: "rev-saved" });
		expect(Object.keys(loaded.calledFlows).sort()).toEqual([
			"draft",
			"kit:github/create-branch",
			"saved",
		]);
	});

	test("a flow the start sends has no revision", () => {
		const loaded = flowsForRun(
			{ saved: { json: flowOf([]), revision: "rev-saved" } },
			{ projectId: "project", flow: flowOf(["saved"]) },
		);
		expect(loaded.flowRevision).toBeNull();
		expect(loaded.calledFlowRevisions).toEqual({ saved: "rev-saved" });
	});
});
