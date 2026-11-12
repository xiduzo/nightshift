import {
	type EndNode,
	endMessage,
	MAX_REPORT_BYTES,
	renderTemplate,
	reportText,
} from "@nightshift/flows";

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
 * The End node: a chosen end of the flow, with a result, one line and
 * maybe a report. Its step renders the message and the report, writes one
 * `end` entry to the transcript and ends with the node's status as its
 * outcome. No edge leaves the node, so `route()` ends the flow there: the
 * run ends with the status as its result (`RunEnded.result`) and the
 * message as its reason. A `failed` End ends the run `failed`, the others
 * `finished`.
 *
 * The report (ADR 26) is kept in the step's outputs (`report`), at most
 * `MAX_REPORT_BYTES`: a longer one is cut at a line break, with a `report`
 * warning. The read model finds the run's report from the step
 * (`read/report.ts`).
 *
 * Inside a called flow it ends that flow; the Call reads the result
 * (`body.ts`) and the report (`end_report`). Pure, so a re-run is safe:
 * every visit is new.
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
				const report =
					node.report?.kind === "text"
						? reportText(renderTemplate(node.report.text, step.tctx))
						: null;
				if (report?.cut) {
					const kb = MAX_REPORT_BYTES / 1024;
					await step.warn(
						"report",
						`This report is longer than ${kb} KB. Night Shift kept the first ${kb} KB.`,
					);
				}
				step.record(null, {
					type: "end",
					status: node.status,
					message,
					...(report ? { report: { cut: report.cut } } : {}),
				});
				return {
					kind: "end",
					outcome: node.status,
					outputs: {
						message: message ?? "",
						...(report ? { report: report.text } : {}),
						visit: step.visit,
					},
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

/** The report of an ended End step, or null when it has none. */
function reportTextOf(outputs: StepOutputs): string | null {
	return typeof outputs.report === "string" && outputs.report !== ""
		? outputs.report
		: null;
}

/**
 * The End kind. Every status is a chosen end: the run's result is the
 * status, and the reason `RunEnded` records is the message. A Call that
 * called the flow reports the status as `ended` and the report as
 * `end_report`.
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
	endReport: (_node, outputs) => reportTextOf(outputs),
};
