import { describe, expect, test } from "bun:test";
import type { AgentNode, Flow, FlowNode } from "@nightshift/flows";
import {
	createRunStart,
	quickRunTitle,
	type RunStartDeps,
	START_TOO_LONG,
} from "./run-start";

/**
 * Run start's own rules: the title of a quick run, and the deadline of a
 * start. The requirements a Device must meet are Placement's
 * (`placement/fit.test.ts`). The whole start path (worktree, run row,
 * `RunStarted`) is covered by engine.test.ts through the public interface.
 */

const node = (fields: Record<string, unknown>): FlowNode =>
	fields as unknown as FlowNode;

const agent = (id: string, fields: Record<string, unknown> = {}) =>
	node({ id, type: "agent", prompt: "work", ...fields }) as AgentNode;

describe("quickRunTitle", () => {
	const flow = (nodes: FlowNode[]): Flow =>
		({
			version: 2,
			start: nodes[0]?.id ?? "a",
			nodes,
			edges: [],
		}) as unknown as Flow;

	test("is the first Agent prompt, whitespace folded", () => {
		expect(
			quickRunTitle(flow([agent("a", { prompt: "  fix\n the   bug " })])),
		).toBe("fix the bug");
	});

	test("falls back when no Agent node has a prompt", () => {
		expect(quickRunTitle(flow([node({ id: "c", type: "command" })]))).toBe(
			"Quick run",
		);
	});

	test("cuts a long prompt at 80 characters with an ellipsis", () => {
		const title = quickRunTitle(
			flow([agent("a", { prompt: "x".repeat(100) })]),
		);
		expect(title).toHaveLength(80);
		expect(title.endsWith("…")).toBe(true);
	});
});

describe("a start that hangs", () => {
	test("is refused after its deadline, and writes nothing after that", async () => {
		let settled = false;
		let release = () => {};
		const deps = {
			startDeadlineMs: 20,
			// The runner frees the start's slot when its prepare settles.
			runner: {
				take: async (_runId: string, turn: { prepare(): Promise<unknown> }) => {
					try {
						await turn.prepare();
					} finally {
						settled = true;
					}
				},
			},
			projectRow: async () => ({ id: "p1", spaceId: "s1" }),
			// The Device never answers: the plan waits until the test ends it.
			plan: () =>
				new Promise((_, reject) => {
					release = () => reject(new Error("released"));
				}),
		} as unknown as RunStartDeps;
		const start = createRunStart(deps).start(
			{ projectId: "p1", flowName: "nightly" },
			{ kind: "manual" },
		);
		await expect(start).rejects.toThrow(START_TOO_LONG);
		expect(settled).toBe(true);
		release();
	});
});
