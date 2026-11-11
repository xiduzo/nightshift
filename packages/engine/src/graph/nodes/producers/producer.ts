import type { JsonValue, ValueNode } from "@nightshift/flows";
import type { StepOutputs } from "../../../log";
import type { NodeAction } from "../../context";
import { outputVerdict } from "../../output-schema";
import type { BodyEnd, StepHandle } from "../../step-runner";

/*
 * What every producer of a Value shares: the seam and the ends of a step.
 * The Value node (`value.ts`) picks a producer by `node.by`, so this file
 * imports none of them, and none of them imports the Value node.
 */

/**
 * A producer runs one visit of the node: it opens the step, makes the
 * value, ends the step and routes on it, or parks or waits instead. It
 * returns what the graph node returns.
 */
export type Producer = NodeAction;

/** The outputs every Value step ends with. */
export function valueOutputs(
	outcome: string,
	data: JsonValue | null,
	note: string,
	visit: number,
): StepOutputs {
	return { outcome, data, note, visit };
}

/**
 * The end of a step with the value made: `pass` with the data when it
 * matches the node's output schema, else `fail` with why in `note`. A
 * schema Night Shift inferred (`outputInferred`) does not fail the step:
 * it passes, and the run warns (`outputVerdict`). The transcript gets the
 * `value` entry either way.
 */
export async function endWithValue(
	step: StepHandle,
	node: ValueNode,
	made: unknown,
	note: string,
	extra?: Pick<BodyEnd, "costUsd" | "costSource">,
): Promise<BodyEnd> {
	const verdict = outputVerdict(node, made);
	if (verdict.kind === "broken") {
		return endWithoutValue(step, verdict.message, extra);
	}
	if (verdict.kind === "warning") await step.warn("shape", verdict.message);
	const data = made as JsonValue;
	step.record(null, { type: "value", data, problem: null });
	return {
		kind: "end",
		outcome: "pass",
		outputs: valueOutputs("pass", data, note, step.visit),
		error: null,
		...extra,
	};
}

/** The end of a step that `fail`s without a value, with why in `note` and the transcript. */
export function endWithoutValue(
	step: StepHandle,
	why: string,
	extra?: Pick<BodyEnd, "costUsd" | "costSource">,
): BodyEnd {
	step.record(null, { type: "value", data: null, problem: why });
	return {
		kind: "end",
		outcome: "fail",
		outputs: valueOutputs("fail", null, why, step.visit),
		error: null,
		...extra,
	};
}
