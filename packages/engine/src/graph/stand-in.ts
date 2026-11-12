import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import {
	type Flow,
	type FlowNode,
	nodeOutputFields,
	type Outcome,
} from "@nightshift/flows";
import type { PinnedOutput, RunState, StepOutputs } from "../log";
import type { NodeAction, StepContext } from "./context";
import { RESUME_RULES } from "./resume-point";
import { scopeOf } from "./route";
import type { RunStateValues } from "./state";
import { runStep } from "./step-runner";

/**
 * The stand-in of a test run (ADR 27): a node the run's start pinned or
 * skipped gives an output without its work. A pinned node gives the
 * output of a step of an earlier run, a skipped node its outcome with
 * every output field null. Either way the step runner opens and ends a
 * step as for any node (`runStep`, `RESUME_RULES.fresh`), with
 * `StepStarted.test` set: the node's `set` writes apply and the normal
 * route follows, so Joins, Sections and branches work. The step asks no
 * Device, has no timers and no rung, costs nothing, scores nothing, and
 * opens no pull request.
 *
 * Only a node of the run's own flow stands in, at the top level: a
 * called flow runs as it is. `compile.ts` wraps each node of the root
 * graph that can stand in (`standsIn`, in `@nightshift/flows` with
 * `standInOutcomes`, so the editor reads the same rule) with
 * `withStandIn`, which reads the run's pins and skips from its
 * `RunStarted` at each visit.
 */

/** How a node of the run's own flow stands in, or null when it runs. */
type StandInOf =
	| { kind: "pinned"; pin: PinnedOutput }
	| { kind: "skipped"; outcome: Outcome };

/** The run's stand-in for a node of its own flow, from its `RunStarted`. */
function standInOf(run: RunState, nodeId: string): StandInOf | null {
	const { test } = run;
	if (test === null) return null;
	const pin = Object.hasOwn(test.pinned, nodeId)
		? test.pinned[nodeId]
		: undefined;
	if (pin) return { kind: "pinned", pin };
	const outcome = Object.hasOwn(test.skipped, nodeId)
		? test.skipped[nodeId]
		: undefined;
	return outcome === undefined ? null : { kind: "skipped", outcome };
}

/**
 * The outputs of a skipped step: each field a later node can read of it
 * null (a Call's called-flow outputs too), its outcome and its visit.
 */
export function skippedOutputs(
	node: FlowNode,
	called: Flow | null,
	outcome: Outcome,
	visit: number,
): StepOutputs {
	const outputs: StepOutputs = {};
	for (const field of nodeOutputFields(node, called)) outputs[field] = null;
	return { ...outputs, outcome, visit };
}

/**
 * The graph node of `node` at the top level of a test run: a stand-in
 * where the run's start pinned or skipped it, else the node's own
 * `action`. Any other run, and a called flow, always runs `action`.
 */
export function withStandIn(
	node: FlowNode,
	ctx: StepContext,
	action: NodeAction,
): NodeAction {
	return async (state: RunStateValues, config: LangGraphRunnableConfig) => {
		if (scopeOf(config) !== null) return action(state, config);
		const standIn = standInOf(await ctx.log.state(ctx.run.id), node.id);
		if (standIn === null) return action(state, config);
		const called = node.type === "call" ? (ctx.flows[node.flow] ?? null) : null;
		return runStep(ctx, node, state, config, {
			rules: RESUME_RULES.fresh,
			standIn: standIn.kind,
			body: async (step) =>
				standIn.kind === "pinned"
					? {
							kind: "end",
							outcome: standIn.pin.outcome,
							outputs: { ...standIn.pin.outputs, visit: step.visit },
							error: null,
						}
					: {
							kind: "end",
							outcome: standIn.outcome,
							outputs: skippedOutputs(
								node,
								called,
								standIn.outcome,
								step.visit,
							),
							error: null,
						},
		});
	};
}
