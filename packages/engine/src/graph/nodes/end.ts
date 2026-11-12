import {
	type EndNode,
	endMessage,
	MAX_REPORT_BYTES,
	renderTemplate,
	reportText,
} from "@nightshift/flows";
import { Refusal, wordsFor } from "@nightshift/refusal";

import type { ReadFileResult } from "../../device";
import type { StepOutputs } from "../../log";
import type { RunResult } from "../../run-status";
import {
	type NodeAction,
	type NodeKind,
	PLAIN_KIND,
	type Requirement,
	type StepContext,
} from "../context";
import { RESUME_RULES } from "../resume-point";
import {
	type BodyEnd,
	type BodyResult,
	runStep,
	type StepHandle,
} from "../step-runner";

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
 * A report from a file is read on the step's Device, in the folder the
 * run works in there (`Device.readFile`). In a project with a folder, the
 * step goes to the Device that has the run's copy now
 * (`NodeKind.followsWork`): no Hand-off, so a file that a step there did
 * not commit is read all the same. A run folder does not move between
 * Devices: the step reads the folder on the run's Device, and a file that
 * a step on another Device wrote in its own folder is missing here. A file
 * that is missing, not text or outside the folder is a `report` warning:
 * the step still ends with the node's status, without a report, so a run
 * that did its work never fails for its report. A Device that went away
 * during the read waits as the network does, and the step reads again. A
 * Device that does not answer, or stays offline, for the run policy's
 * network grace is a `report` warning too (`StepSpec.givesUp`): a report
 * never keeps a run open longer than the grace. So is a Device that cannot
 * be made ready for the read, such as a run whose copy of the project was
 * not made yet and cannot be made now. A stop still stops the step.
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
				const report = await reportOf(node, step);
				if (report.kind === "instead") return report.result;
				return endWith(node, step, report);
			},
			// The Device did not answer the read, or stayed offline, for the
			// run policy's network grace, or it cannot be made ready for the
			// read: the run ends without its report.
			...(readsFile(node)
				? {
						givesUp: (step: StepHandle, why: string | null) =>
							endWith(node, step, {
								kind: "kept",
								kept: { text: "", cut: false },
								warning:
									why === null
										? `Night Shift could not read the report file on ${step.device.name}. ${WITHOUT_REPORT}`
										: `Night Shift could not read the report file. ${why} ${WITHOUT_REPORT}`,
							}),
					}
				: {}),
		});
}

/** Ends the step with the node's status, its message and the report it keeps, after its warning. */
async function endWith(
	node: EndNode,
	step: StepHandle,
	report: Kept,
): Promise<BodyEnd> {
	const message = endMessage(renderTemplate(node.message ?? "", step.tctx));
	if (report.warning !== null) {
		await step.warn("report", report.warning);
	}
	const { kept } = report;
	step.record(null, {
		type: "end",
		status: node.status,
		message,
		...(kept ? { report: { cut: kept.cut } } : {}),
	});
	return {
		kind: "end",
		outcome: node.status,
		outputs: {
			message: message ?? "",
			...(kept ? { report: kept.text } : {}),
			visit: step.visit,
		},
		error: null,
	};
}

/** What the last words of every warning about a report file that was not read say. */
const WITHOUT_REPORT = "The run ends without a report.";

/** The report a step keeps (null: the node has none), and what a person should know about it. */
type Kept = {
	kind: "kept";
	kept: { text: string; cut: boolean } | null;
	warning: string | null;
};

type KeptReport =
	| Kept
	/**
	 * The read did not end: the Device went away (the step waits, then
	 * reads again), or a stop came.
	 */
	| { kind: "instead"; result: BodyResult };

/** What a person reads when the report is longer than the cap. */
function cutWarning(): string {
	const kb = MAX_REPORT_BYTES / 1024;
	return `This report is longer than ${kb} KB. Night Shift kept the first ${kb} KB.`;
}

/** The report of the End step: its own text, or the file the run wrote, rendered and cut. */
async function reportOf(node: EndNode, step: StepHandle): Promise<KeptReport> {
	const { report } = node;
	if (report === undefined) return { kind: "kept", kept: null, warning: null };
	if (report.kind === "text") {
		const kept = reportText(renderTemplate(report.text, step.tctx));
		return { kind: "kept", kept, warning: kept.cut ? cutWarning() : null };
	}
	const path = renderTemplate(report.path, step.tctx).trim();
	const read = await readReport(path, step);
	if ("result" in read) return { kind: "instead", result: read.result };
	if (read.kind !== "text") {
		// The node has a report, but the run has none: an empty one.
		return {
			kind: "kept",
			kept: { text: "", cut: false },
			warning: `${unreadable(read, path, step.device.name)} ${WITHOUT_REPORT}`,
		};
	}
	const kept = reportText(read.text);
	const cut = read.cut || kept.cut;
	return {
		kind: "kept",
		kept: { text: kept.text, cut },
		warning: cut ? cutWarning() : null,
	};
}

/** Why a report file was not read, for its warning. */
type Unreadable =
	| Exclude<ReadFileResult, { kind: "text" }>
	| { kind: "empty" }
	| { kind: "refused"; message: string };

/**
 * Reads the report file on the step's Device: `path` as the template
 * rendered it, relative to the folder the run works in (`./` and empty
 * parts dropped). The Device keeps the read inside that folder.
 */
async function readReport(
	path: string,
	step: StepHandle,
): Promise<ReadFileResult | Unreadable | { result: BodyResult }> {
	if (path.startsWith("/")) return { kind: "outside" };
	const relative = path
		.split("/")
		.filter((part) => part !== "" && part !== ".")
		.join("/");
	if (relative === "") return { kind: "empty" };
	const { device } = step;
	if (!device.readFile) {
		return { kind: "refused", message: olderDevice(device.name) };
	}
	try {
		return await device.readFile({
			cwd: step.worktree,
			path: relative,
			maxBytes: MAX_REPORT_BYTES,
			signal: step.signal,
		});
	} catch (error) {
		if (step.signal.aborted) {
			return {
				result: {
					kind: "aborted",
					outputs: { message: "", visit: step.visit },
				},
			};
		}
		if (error instanceof Refusal && error.kind === "unavailable") {
			return {
				result: {
					kind: "wait",
					reason: "network",
					message: error.message,
					resetAt: null,
					harnessSessionId: null,
				},
			};
		}
		return { kind: "refused", message: wordsFor(error) };
	}
}

/** The first words of the warning for a report file that was not read. */
function unreadable(why: Unreadable, path: string, device: string): string {
	switch (why.kind) {
		case "empty":
			return "The path of the report file is empty.";
		case "missing":
			return `Night Shift found no file "${path}" in the folder the run works in on ${device}.`;
		case "not-text":
			return `"${path}" is not a text file. Write the report as Markdown or plain text.`;
		case "outside":
			return `"${path}" is not a file inside the folder the run works in.`;
		case "refused":
			return `Night Shift could not read the report file. ${why.message}`;
	}
}

/** Why a Device of an older Night Shift reads no report file. */
function olderDevice(name: string): string {
	return `${name} runs an older version of Night Shift. Update Night Shift on ${name}.`;
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

/** An End that reads its report from a file: it works in the folder the run works in. */
function readsFile(node: EndNode): boolean {
	return node.report?.kind === "file";
}

/** A Device of an older Night Shift reads no report file. */
const readsReportFiles: Requirement<EndNode> = (nodes, has) => {
	const reading = nodes.filter(readsFile);
	if (reading.length === 0 || has.readFiles) return null;
	const where = has.elsewhere ?? "this computer";
	return `The flow ends with a report from a file (${reading.map((n) => n.id).join(", ")}), but ${olderDevice(where)}`;
};

/**
 * The End kind. Every status is a chosen end: the run's result is the
 * status, and the reason `RunEnded` records is the message. A Call that
 * called the flow reports the status as `ended` and the report as
 * `end_report`. An End that reads its report from a file works in the
 * folder the run works in, on the Device that has the run's copy, and
 * sleeps while that Device is offline, for the network grace at most.
 */
export const END: NodeKind<EndNode> = {
	...PLAIN_KIND,
	type: "end",
	make: endStepNode,
	works: (node) => (readsFile(node) ? "worktree" : null),
	followsWork: readsFile,
	aux: (node) => (readsFile(node) ? [{ kind: "wait" }] : []),
	resumeRules: () => RESUME_RULES.fresh,
	isChosenEnd: () => true,
	endReason: (_node, _outcome, outputs) => messageOf(outputs),
	endResult: (node) => node.status satisfies RunResult,
	endedLabel: (node) => node.status,
	endReport: (_node, outputs) => reportTextOf(outputs),
	requirements: [readsReportFiles],
};
