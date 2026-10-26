import { Command } from "@langchain/langgraph";
import type { JoinNode, JsonValue } from "@nightshift/flows";
import { fanOutOf, placeOf } from "../branches";
import {
	endedAtReason,
	type NodeAction,
	type NodeKind,
	PLAIN_KIND,
	type StepContext,
} from "../context";
import { RESUME_RULES } from "../resume-point";
import type { JoinRound, RunStateValues } from "../state";
import { runStep } from "../step-runner";

/**
 * The Join node: where the branches of a fan-out meet (`branches.ts`).
 * Each branch that reaches it arrives in its round (`route()` writes the
 * arrival), and every arrival runs this node. Until its rule holds the
 * node does nothing: no step, no route. Then one step, at once:
 *
 * - `all`: every branch of the fan-out arrived.
 * - `first`: a branch arrived. The others were stopped when it did, and a
 *   step of theirs that ends later goes no further.
 *
 * The step ends `done` with `data`: each arrived branch's `data` (null when
 * its step has none), keyed by the node the branch entered the Join from,
 * in the order they arrived. With `first`, the earliest only. Its route
 * closes the round, so a branch that arrives late is not counted again.
 *
 * Every visit is new (`RESUME_RULES.fresh`): the arrivals are in the
 * checkpoint, so a Join that a crash cut short decides again the same.
 */
export function joinNode(node: JoinNode, ctx: StepContext): NodeAction {
	return async (state, config) => {
		const round = state.joins?.[node.id];
		const arrived = round ? ready(ctx, node, round) : null;
		if (!round || round.closed || !arrived) return new Command({});
		return runStep(ctx, node, state, config, {
			rules: RESUME_RULES.fresh,
			update: {
				joins: { [node.id]: { ...round, closed: true } },
			},
			async body(step) {
				return {
					kind: "end",
					outcome: "done",
					outputs: { visit: step.visit, data: dataOf(state, arrived) },
					error: null,
				};
			},
			outputs: (step) => ({ visit: step.visit, data: null }),
		});
	};
}

/**
 * The arrivals the Join goes on with, once its rule holds: every branch
 * (`all`), or the earliest (`first`). Null while it waits.
 */
function ready(
	ctx: StepContext,
	node: JoinNode,
	round: JoinRound,
): JoinRound["arrived"] | null {
	const fanOut = fanOutOf(ctx.flow, node.id);
	if (!fanOut) return null;
	const counted = round.arrived.filter(
		(a) => placeOf(ctx.flow, a.from)?.fanOut === fanOut,
	);
	if (node.wait === "first") {
		const [earliest] = [...counted].sort((a, b) => a.at - b.at);
		return earliest ? [earliest] : null;
	}
	const branches = new Set(
		counted.map((a) => placeOf(ctx.flow, a.from)?.branch),
	);
	return fanOut.branches.every((branch) => branches.has(branch))
		? counted
		: null;
}

/** Each arrival's step data, keyed by the node it came from. */
function dataOf(
	state: RunStateValues,
	arrived: JoinRound["arrived"],
): Record<string, JsonValue> {
	const data: Record<string, JsonValue> = {};
	for (const { from } of arrived) {
		data[from] = (state.nodes[from]?.data as JsonValue | undefined) ?? null;
	}
	return data;
}

/** The Join kind: the plain facts, with `done` its one chosen end. */
export const JOIN: NodeKind<JoinNode> = {
	...PLAIN_KIND,
	type: "join",
	make: joinNode,
	resumeRules: () => RESUME_RULES.fresh,
	isChosenEnd: (_node, outcome) => outcome === "done",
	endReason: (node, outcome) =>
		outcome === "done" ? null : endedAtReason(node, outcome),
};
