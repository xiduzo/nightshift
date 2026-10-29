import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, type FlowEdge } from "@nightshift/flows";
import { commandNode } from "@nightshift/flows/testing";
import {
	type EdgeSegment,
	groupEdges,
	groupSegments,
	labelAtRest,
	labelText,
} from "./edge-groups";

const origin = { x: 0, y: 0 };

function edge(
	from: string,
	outcome: string,
	to: string,
	max?: number,
): FlowEdge {
	return { id: `${from}-${outcome}-${to}`, from, outcome, to, max };
}

function flowOf(edges: FlowEdge[]): Flow {
	return {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: "a",
		nodes: ["a", "b", "c"].map((id) => commandNode(id, origin)),
		edges,
	};
}

describe("groupEdges", () => {
	test("draws one edge per node pair, its outcomes in handle order", () => {
		// Command nodes show success, failure, other.
		const groups = groupEdges(
			flowOf([
				edge("a", "other", "b"),
				edge("a", "success", "c"),
				edge("a", "success", "b"),
				edge("b", "failure", "c"),
			]),
		);
		expect(
			groups.map((group) => [group.id, group.key, group.edges.length]),
		).toEqual([
			["a-success-b", "a->b", 2],
			["a-success-c", "a->c", 1],
			["b-failure-c", "b->c", 1],
		]);
		expect(groups[0]?.edges.map((e) => e.outcome)).toEqual([
			"success",
			"other",
		]);
	});

	test("puts outcomes the node does not have last, and skips missing nodes", () => {
		const groups = groupEdges(
			flowOf([
				edge("a", "gone", "b"),
				edge("a", "failure", "b"),
				edge("a", "success", "ghost"),
			]),
		);
		expect(groups).toHaveLength(1);
		expect(groups[0]?.edges.map((e) => e.outcome)).toEqual(["failure", "gone"]);
	});

	test("keeps every edge: the run counts of a drawn edge add up", () => {
		const flow = flowOf([
			edge("a", "success", "b"),
			edge("a", "failure", "b"),
			edge("a", "other", "c"),
		]);
		const ids = groupEdges(flow).flatMap((group) =>
			group.edges.map((e) => e.id),
		);
		expect(ids.sort()).toEqual(flow.edges.map((e) => e.id).sort());
	});
});

describe("labels", () => {
	const segment = (over: Partial<EdgeSegment>): EdgeSegment => ({
		id: "x",
		outcome: "pass",
		onNode: true,
		...over,
	});

	test("hides a label the node row already shows", () => {
		expect(labelAtRest([segment({})])).toBe(false);
		expect(labelAtRest([segment({ traversals: 0 })])).toBe(false);
	});

	test("shows merged edges, a max, run counts, errors and unknown outcomes", () => {
		expect(labelAtRest([segment({}), segment({ outcome: "fail" })])).toBe(true);
		expect(labelAtRest([segment({ max: 2 })])).toBe(true);
		expect(labelAtRest([segment({ traversals: 1 })])).toBe(true);
		expect(labelAtRest([segment({ hasError: true })])).toBe(true);
		expect(labelAtRest([segment({ onNode: false })])).toBe(true);
	});

	test("lists each outcome with its max and run count", () => {
		expect(
			labelText([segment({ max: 3 }), segment({ outcome: "changes" })]),
		).toBe("pass ×3 · changes");
		expect(
			labelText([
				segment({ traversals: 2, max: 3 }),
				segment({ outcome: "changes", traversals: 0, max: 2 }),
				segment({ outcome: "other", traversals: 1 }),
			]),
		).toBe("pass taken 2/3 · changes max 2 · other taken 1");
	});

	test("knows which outcomes the source node shows", () => {
		const flow = flowOf([edge("a", "success", "b"), edge("a", "gone", "b")]);
		const [group] = groupEdges(flow);
		expect(
			group && groupSegments(flow, group).map((s) => [s.outcome, s.onNode]),
		).toEqual([
			["success", true],
			["gone", false],
		]);
	});

	test("marks the edges of a fan-out: they run at once, and the label says so at rest", () => {
		const flow = flowOf([edge("a", "success", "b"), edge("a", "success", "c")]);
		const segments = groupEdges(flow).flatMap((group) =>
			groupSegments(flow, group),
		);
		expect(segments.map((s) => s.parallel)).toEqual([true, true]);
		expect(labelText(segments.slice(0, 1))).toBe("success, at once");
		expect(labelAtRest(segments.slice(0, 1))).toBe(true);
		const tried = flowOf([
			edge("a", "success", "b", 2),
			edge("a", "success", "c"),
		]);
		expect(
			groupEdges(tried).flatMap((group) =>
				groupSegments(tried, group).map((s) => s.parallel ?? false),
			),
		).toEqual([false, false]);
	});
});
