import { describe, expect, test } from "bun:test";
import { metricsByNode } from "./node-metrics";

const tokens = (input: number, output: number) => ({
	input,
	output,
	cacheRead: 0,
	cacheWrite: 0,
});

function step(
	nodeId: string,
	startedAt: number,
	endedAt: number | null,
	extra: {
		costUsd?: number;
		costEstimated?: boolean;
		costMissing?: number;
		agentMs?: number;
		gateWaitMs?: number;
		tokens?: ReturnType<typeof tokens>;
		noMetrics?: boolean;
	} = {},
) {
	return {
		nodeId,
		startedAt,
		endedAt,
		costUsd: extra.costUsd ?? 0,
		costEstimated: extra.costEstimated ?? false,
		costMissing: extra.costMissing ?? 0,
		metrics: extra.noMetrics
			? undefined
			: {
					wallMs: endedAt === null ? null : endedAt - startedAt,
					agentMs: extra.agentMs ?? 0,
					gateWaitMs: extra.gateWaitMs ?? 0,
					tokens: extra.tokens ?? tokens(0, 0),
					costBasis: "billed" as const,
					prUrl: null,
				},
	};
}

describe("metricsByNode", () => {
	test("adds up every visit of a node, in the order the nodes first ran", () => {
		const nodes = metricsByNode([
			step("build", 0, 100, { costUsd: 1, agentMs: 90, tokens: tokens(10, 2) }),
			step("check", 100, 110),
			step("build", 110, 200, {
				costUsd: 0.5,
				costEstimated: true,
				agentMs: 80,
				tokens: tokens(5, 1),
			}),
			step("ship", 200, 900, { gateWaitMs: 650 }),
		]);
		expect(nodes.map((n) => n.nodeId)).toEqual(["build", "check", "ship"]);
		expect(nodes[0]).toEqual({
			nodeId: "build",
			visits: 2,
			wallMs: 190,
			open: false,
			agentMs: 170,
			gateWaitMs: 0,
			tokens: tokens(15, 3),
			cost: { costUsd: 1.5, costEstimated: true, costMissing: 0 },
		});
		expect(nodes[2]?.gateWaitMs).toBe(650);
	});

	test("leaves a visit that runs out of the time, and says it is open", () => {
		const [node] = metricsByNode([
			step("build", 0, 100),
			step("build", 100, null),
		]);
		expect(node).toMatchObject({ visits: 2, wallMs: 100, open: true });
	});

	test("reads the time of a step from an older Host from its start and end", () => {
		const [node] = metricsByNode([
			step("build", 0, 40, { noMetrics: true, costMissing: 1 }),
		]);
		expect(node).toMatchObject({
			wallMs: 40,
			tokens: tokens(0, 0),
			cost: { costUsd: 0, costEstimated: false, costMissing: 1 },
		});
	});
});
