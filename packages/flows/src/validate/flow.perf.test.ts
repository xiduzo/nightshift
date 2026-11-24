import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow } from "../flow";
import { fanOutsOf } from "../flow/walk/branches";
import { moveNodes } from "../flows/graph/graph";
import { commandNode } from "../nodes/do/command";
import { validateFlow } from "./flow";

/**
 * Scale of a flow check and of moving many nodes. Four times the nodes
 * stays under eight times the cost. The check reads each edge a constant
 * number of times, and a move copies the flow once.
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
	const sections = [];
	for (let i = 0; i < count; i += 20) {
		sections.push({
			id: `s${i}`,
			label: "Part",
			nodes: nodes.slice(i, i + 20).map((node) => node.id),
		});
	}
	return {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: "n0",
		nodes,
		edges,
		sections,
	};
}

/** One node, then `count` edges that run at once, one node each. */
function star(count: number): Flow {
	const nodes = [commandNode("hub", { x: 0, y: 0 })];
	const edges = [];
	for (let i = 0; i < count; i++) {
		nodes.push(commandNode(`n${i}`, { x: i, y: 40 }));
		edges.push({
			id: `e${i}`,
			from: "hub",
			outcome: "success" as const,
			to: `n${i}`,
		});
	}
	return {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: "hub",
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

describe("flow checks stay linear", () => {
	test("a chain with Sections", () => {
		const small = chain(400);
		const large = chain(1600);
		const measured = costs(
			() => validateFlow(small),
			() => validateFlow(large),
			12,
		);
		expectLinear(measured, 4);
	}, 20_000);

	test("a fan-out", () => {
		const small = star(400);
		const large = star(1600);
		const measured = costs(
			() => fanOutsOf(small),
			() => fanOutsOf(large),
			160,
		);
		expectLinear(measured, 4);
		expect(fanOutsOf(large)).toHaveLength(1);
	}, 20_000);

	test("moving every node", () => {
		const place = (flow: Flow) => {
			const positions = new Map(
				flow.nodes.map((node, i) => [node.id, { x: i, y: 8 }]),
			);
			return moveNodes(flow, positions);
		};
		const small = chain(400);
		const large = chain(1600);
		const measured = costs(
			() => place(small),
			() => place(large),
			400,
		);
		expectLinear(measured, 4);
		expect(place(large).nodes[3]?.position).toEqual({ x: 3, y: 8 });
	}, 20_000);
});
