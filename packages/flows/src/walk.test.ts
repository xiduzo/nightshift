import { describe, expect, test } from "bun:test";
import type { Flow, FlowEdge } from "./schema";
import { nextEdge } from "./walk";

function flowWith(edges: FlowEdge[]): Flow {
	return {
		version: 1,
		start: "worker",
		nodes: [
			{
				id: "worker",
				type: "agent",
				position: { x: 0, y: 0 },
				prompt: "Fix it",
				harness: "claude-code",
				model: "sonnet",
				permissionMode: "acceptEdits",
				session: "fresh",
			},
			{
				id: "check",
				type: "command",
				position: { x: 200, y: 0 },
				command: "bun test",
			},
		],
		edges,
	};
}

const retryLoop = flowWith([
	{ id: "work-done", from: "worker", outcome: "pass", to: "check" },
	{ id: "retry", from: "check", outcome: "fail", to: "worker", max: 3 },
]);

describe("nextEdge", () => {
	test("takes the edge for the outcome", () => {
		expect(
			nextEdge({
				flow: retryLoop,
				from: "worker",
				outcome: "pass",
				traversals: {},
			}),
		).toEqual({ kind: "edge", edge: retryLoop.edges[0] as FlowEdge });
	});

	test("ends when no edge leaves the node on that outcome", () => {
		expect(
			nextEdge({
				flow: retryLoop,
				from: "check",
				outcome: "pass",
				traversals: {},
			}),
		).toEqual({ kind: "end" });
		expect(
			nextEdge({
				flow: retryLoop,
				from: "worker",
				outcome: "fail",
				traversals: {},
			}),
		).toEqual({ kind: "end" });
	});

	test("a retry loop with max 3 is exhausted after 3 traversals", () => {
		const traversals: Record<string, number> = {};
		const taken: string[] = [];
		for (let round = 0; round < 10; round++) {
			const next = nextEdge({
				flow: retryLoop,
				from: "check",
				outcome: "fail",
				traversals,
			});
			if (next.kind !== "edge") {
				expect(next).toEqual({
					kind: "exhausted",
					edges: [retryLoop.edges[1] as FlowEdge],
				});
				break;
			}
			taken.push(next.edge.id);
			traversals[next.edge.id] = (traversals[next.edge.id] ?? 0) + 1;
		}
		expect(taken).toEqual(["retry", "retry", "retry"]);
		expect(traversals).toEqual({ retry: 3 });
	});

	test("falls through to the next edge once the first hits its max", () => {
		const flow = flowWith([
			{ id: "retry", from: "check", outcome: "fail", to: "worker", max: 2 },
			{ id: "give-up", from: "check", outcome: "fail", to: "worker" },
		]);
		const input = { flow, from: "check", outcome: "fail" } as const;
		expect(nextEdge({ ...input, traversals: { retry: 1 } })).toMatchObject({
			kind: "edge",
			edge: { id: "retry" },
		});
		expect(nextEdge({ ...input, traversals: { retry: 2 } })).toMatchObject({
			kind: "edge",
			edge: { id: "give-up" },
		});
	});

	test("an edge without max is never exhausted", () => {
		const flow = flowWith([
			{ id: "again", from: "check", outcome: "fail", to: "worker" },
		]);
		expect(
			nextEdge({
				flow,
				from: "check",
				outcome: "fail",
				traversals: { again: 1000 },
			}),
		).toMatchObject({ kind: "edge", edge: { id: "again" } });
	});

	test("exhausted lists every edge for the outcome, in file order", () => {
		const flow = flowWith([
			{ id: "a", from: "check", outcome: "fail", to: "worker", max: 1 },
			{ id: "other", from: "check", outcome: "pass", to: "worker", max: 1 },
			{ id: "b", from: "check", outcome: "fail", to: "worker", max: 2 },
		]);
		const next = nextEdge({
			flow,
			from: "check",
			outcome: "fail",
			traversals: { a: 1, b: 2 },
		});
		expect(next.kind).toBe("exhausted");
		if (next.kind === "exhausted") {
			expect(next.edges.map((edge) => edge.id)).toEqual(["a", "b"]);
		}
	});
});
