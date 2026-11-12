import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow } from "@nightshift/flows";
import { commandNode } from "@nightshift/flows/testing";
import { flowGraph, walk } from "../editor/lib/flow-layout";
import { groupEdges } from "./edge-groups";
import { canvasEdges } from "./outcome-edge";

/**
 * Scale of the canvas build, before React Flow draws it. Four times the
 * nodes stays under eight times the cost. Drawn edges and the layout
 * graph each read the flow once.
 */

function chain(count: number): Flow {
	const nodes = [];
	const edges = [];
	for (let i = 0; i < count; i++) {
		nodes.push({
			...commandNode(`n${i}`, { x: i * 40, y: 0 }),
			command: "true",
		});
		if (i > 0) {
			edges.push({
				id: `e${i}`,
				from: `n${i - 1}`,
				outcome: "success" as const,
				to: `n${i}`,
			});
		}
	}
	return {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: "n0",
		nodes,
		edges,
	};
}

function elapsed(run: () => void, times: number): number {
	run();
	const started = performance.now();
	for (let i = 0; i < times; i++) run();
	return performance.now() - started;
}

/**
 * `large` did `factor` times the work. Twice a linear step is the line.
 * A cost that reads the list once per node lands past it.
 */
function expectLinear(smallMs: number, largeMs: number, factor: number): void {
	expect(smallMs).toBeGreaterThan(8);
	expect(largeMs).toBeLessThan(smallMs * factor * 1.9 + 15);
}

describe("the canvas build stays linear", () => {
	test("drawn edges", () => {
		const small = chain(400);
		const large = chain(1600);
		const smallGroups = groupEdges(small);
		const largeGroups = groupEdges(large);
		const smallMs = elapsed(() => canvasEdges(small, smallGroups), 80);
		const largeMs = elapsed(() => canvasEdges(large, largeGroups), 80);
		expectLinear(smallMs, largeMs, 4);
		expect(canvasEdges(large, largeGroups)).toHaveLength(1599);
	}, 20_000);

	test("the layout graph", () => {
		const small = chain(400);
		const large = chain(1600);
		const smallMs = elapsed(() => {
			walk(small);
			flowGraph(small);
		}, 24);
		const largeMs = elapsed(() => {
			walk(large);
			flowGraph(large);
		}, 24);
		expectLinear(smallMs, largeMs, 4);
		expect(flowGraph(large).nodes).toHaveLength(1600);
	}, 20_000);
});
