import { type EndNode, endMessage, renderTemplate } from "@nightshift/flows";

import type { StepOutputs } from "../../log";
import type { RunResult } from "../../run-status";
import {
	type NodeAction,
	type NodeKind,
	PLAIN_KIND,
	type StepContext,
} from "../context";
import { RESUME_RULES } from "../resume-point";
import { runStep } from "../step-runner";

/**
 * The End node: a chosen end of the flow, with a result and one line. Its
 * step renders the message, writes one `end` entry to the transcript and
 * ends with the node's status as its outcome. No edge leaves the node, so
 * `route()` ends the flow there: the run ends with the status as its
 * result (`RunEnded.result`) and the message as its reason. A `failed`
 * End ends the run `failed`, the others `finished`.
 *
 * Inside a called flow it ends that flow; the Call reads the result
 * (`body.ts`). Pure, so a re-run is safe: every visit is new.
 */
export function endStepNode(node: EndNode, ctx: StepContext): NodeAction {
	return (state, config) =>
		runStep(ctx, node, state, config, {
			rules: RESUME_RULES.fresh,
			outputs: (step) => ({ message: "", visit: step.visit }),
			async body(step) {
				const message = endMessage(
					renderTemplate(node.message ?? "", step.tctx),
				);
				step.record(null, { type: "end", status: node.status, message });
				return {
					kind: "end",
					outcome: node.status,
					outputs: { message: message ?? "", visit: step.visit },
					error: null,
				};
			},
		});
}

/** The rendered message of an ended End step, or null when it has none. */
function messageOf(outputs: StepOutputs): string | null {
	return typeof outputs.message === "string" && outputs.message !== ""
		? outputs.message
		: null;
}

/**
 * The End kind. Every status is a chosen end: the run's result is the
 * status, and the reason `RunEnded` records is the message. A Call that
 * called the flow reports the status as `ended`.
 */
export const END: NodeKind<EndNode> = {
	...PLAIN_KIND,
	type: "end",
	make: endStepNode,
	resumeRules: () => RESUME_RULES.fresh,
	isChosenEnd: () => true,
	endReason: (_node, _outcome, outputs) => messageOf(outputs),
	endResult: (node) => node.status satisfies RunResult,
	endedLabel: (node) => node.status,
};
