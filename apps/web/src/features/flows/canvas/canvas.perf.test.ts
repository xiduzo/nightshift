import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow } from "@nightshift/flows";
import { commandNode } from "@nightshift/flows/testing";
import { groupEdges } from "./edges/edge-groups";
import { canvasEdges } from "./edges/outcome-edge";
import { flowGraph, walk } from "./layout/layout-graph";

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

/**
 * The time this thread worked so far, in ms. The time that the machine
 * gives to other work does not count, so a busy machine does not change it.
 */
function workedMs(): number {
	const { user, system } = process.threadCpuUsage();
	return (user + system) / 1_000;
}

function cost(run: () => void, times: number): number {
	const started = workedMs();
	for (let i = 0; i < times; i++) run();
	return workedMs() - started;
}

/** A measurement of `small` below this many ms is too small to mean something. */
const FLOOR_MS = 8;

/**
 * The lowest of five rounds of `calls` calls of `small` and of `large`,
 * measured in turns. A disturbance only adds to a measurement, so the
 * lowest one is the nearest to the cost.
 */
function lowest(
	small: () => void,
	large: () => void,
	calls: number,
): { smallMs: number; largeMs: number } {
	let smallMs = Number.POSITIVE_INFINITY;
	let largeMs = Number.POSITIVE_INFINITY;
	for (let round = 0; round < 5; round++) {
		smallMs = Math.min(smallMs, cost(small, calls));
		largeMs = Math.min(largeMs, cost(large, calls));
	}
	return { smallMs, largeMs };
}

/**
 * What the same number of calls of `small` and of `large` cost. It starts
 * at `times` calls and doubles them until `small` costs twice the floor. A
 * fast machine does more calls, so the measurement always means something.
 */
function costs(
	small: () => void,
	large: () => void,
	times: number,
): { smallMs: number; largeMs: number } {
	small();
	large();
	let calls = times;
	let measured = lowest(small, large, calls);
	while (measured.smallMs < FLOOR_MS * 2 && calls < 1_000_000) {
		calls *= 2;
		measured = lowest(small, large, calls);
	}
	return measured;
}

/**
 * `large` did `factor` times the work. Twice a linear step is the line.
 * A cost that reads the list once per node lands past it.
 */
function expectLinear(
	{ smallMs, largeMs }: { smallMs: number; largeMs: number },
	factor: number,
): void {
	expect(smallMs).toBeGreaterThan(FLOOR_MS);
	expect(largeMs).toBeLessThan(smallMs * factor * 1.9 + 15);
}

describe("the canvas build stays linear", () => {
	test("drawn edges", () => {
		const small = chain(400);
		const large = chain(1600);
		const smallGroups = groupEdges(small);
		const largeGroups = groupEdges(large);
		const measured = costs(
			() => canvasEdges(small, smallGroups),
			() => canvasEdges(large, largeGroups),
			80,
		);
		expectLinear(measured, 4);
		expect(canvasEdges(large, largeGroups)).toHaveLength(1599);
	}, 20_000);

	test("the layout graph", () => {
		const small = chain(400);
		const large = chain(1600);
		const measured = costs(
			() => {
				walk(small);
				flowGraph(small);
			},
			() => {
				walk(large);
				flowGraph(large);
			},
			24,
		);
		expectLinear(measured, 4);
		expect(flowGraph(large).nodes).toHaveLength(1600);
	}, 20_000);
});
