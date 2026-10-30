import type { KnownCost } from "./format";
import type { StepSummary } from "./types";

/** The tokens a run's or a step's agents used (`metrics.tokens`). */
export type TokenCounts = NonNullable<StepSummary["metrics"]>["tokens"];

/** What every visit of one node took, used and cost, together. */
export type NodeMetrics = {
	nodeId: string;
	/** Its steps: every visit, also inside called flows. */
	visits: number;
	/** The time of its visits that ended, added up. */
	wallMs: number;
	/** A visit has not ended yet: `wallMs` leaves it out. */
	open: boolean;
	/** How long its agent sessions worked. */
	agentMs: number;
	/** How long its Gates waited for a person. */
	gateWaitMs: number;
	tokens: TokenCounts;
	cost: KnownCost;
};

const NO_TOKENS: TokenCounts = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
};

/**
 * The metrics of a run's steps per node, in the order the nodes first
 * ran: what the run's per-node rows show. A step from an older Host,
 * without metrics, counts its time from its start and end, and no tokens.
 */
export function metricsByNode(
	steps: readonly Pick<
		StepSummary,
		| "nodeId"
		| "startedAt"
		| "endedAt"
		| "costUsd"
		| "costEstimated"
		| "costMissing"
		| "metrics"
	>[],
): NodeMetrics[] {
	const byNode = new Map<string, NodeMetrics>();
	for (const step of steps) {
		const node = byNode.get(step.nodeId) ?? {
			nodeId: step.nodeId,
			visits: 0,
			wallMs: 0,
			open: false,
			agentMs: 0,
			gateWaitMs: 0,
			tokens: NO_TOKENS,
			cost: { costUsd: 0, costEstimated: false, costMissing: 0 },
		};
		const { metrics } = step;
		const wallMs =
			metrics?.wallMs ??
			(step.endedAt === null ? null : step.endedAt - step.startedAt);
		const tokens = metrics?.tokens ?? NO_TOKENS;
		byNode.set(step.nodeId, {
			...node,
			visits: node.visits + 1,
			wallMs: node.wallMs + (wallMs ?? 0),
			open: node.open || step.endedAt === null,
			agentMs: node.agentMs + (metrics?.agentMs ?? 0),
			gateWaitMs: node.gateWaitMs + (metrics?.gateWaitMs ?? 0),
			tokens: {
				input: node.tokens.input + tokens.input,
				output: node.tokens.output + tokens.output,
				cacheRead: node.tokens.cacheRead + tokens.cacheRead,
				cacheWrite: node.tokens.cacheWrite + tokens.cacheWrite,
			},
			cost: {
				costUsd: node.cost.costUsd + step.costUsd,
				costEstimated: Boolean(node.cost.costEstimated || step.costEstimated),
				costMissing: (node.cost.costMissing ?? 0) + step.costMissing,
			},
		});
	}
	return [...byNode.values()];
}
