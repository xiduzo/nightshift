import { describe, expect, test } from "bun:test";
import type { FlowNode } from "@nightshift/flows";
import type { RunRow, Scope } from "../log";
import { stepShapes } from "./kept-shapes";
import { kindOf } from "./node-kinds";

describe("stepShapes", () => {
	const ctx = (runFlow: string | null, flowName = runFlow ?? "Quick run") => ({
		run: { flowName: runFlow, spaceId: "space", projectId: "p" } as RunRow,
		flowName,
		kindOf,
	});
	const scope: Scope = { parentStepId: "s", itemId: null };
	const agent = { id: "a", type: "agent", position: { x: 0, y: 0 } };
	const data = { outputs: { outcome: "pass", data: { title: "x" } } };

	test("the shape of the data of a node without a schema, by its field", () => {
		expect(
			stepShapes(ctx("nightly"), agent as FlowNode, null, "pass", data.outputs),
		).toEqual({
			data: { type: "object", properties: { title: { type: "string" } } },
		});
	});

	test("nothing for a quick run, a kit, a failed step, no data or a schema", () => {
		const of = (
			c: ReturnType<typeof ctx>,
			node: Record<string, unknown>,
			outcome: string,
			outputs: Record<string, unknown>,
			at: Scope | null = null,
		) =>
			stepShapes(c, node as unknown as FlowNode, at, outcome, outputs as never);
		expect(of(ctx(null), agent, "pass", data.outputs)).toBeUndefined();
		// A body of a kit runs in the kit, which is Night Shift's own.
		expect(
			of(
				ctx("nightly", "kit:github/publish"),
				agent,
				"pass",
				data.outputs,
				scope,
			),
		).toBeUndefined();
		expect(of(ctx("nightly"), agent, "error", data.outputs)).toBeUndefined();
		// A step that failed: its data is an error's, not the node's shape.
		expect(of(ctx("nightly"), agent, "fail", data.outputs)).toBeUndefined();
		expect(
			of(ctx("nightly"), agent, "pass", { outcome: "pass", data: null }),
		).toBeUndefined();
		expect(
			of(
				ctx("nightly"),
				{ ...agent, output: { type: "object" } },
				"pass",
				data.outputs,
			),
		).toBeUndefined();
		expect(
			of(ctx("nightly"), { ...agent, type: "end" }, "pass", data.outputs),
		).toBeUndefined();
	});

	test("a called flow keeps the shapes of its own nodes", () => {
		expect(
			stepShapes(
				ctx("nightly", "review"),
				agent as FlowNode,
				scope,
				"pass",
				data.outputs,
			),
		).toBeDefined();
	});
});
