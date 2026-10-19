import type { JsonValue, ValueNode } from "@nightshift/flows";
import type { StepOutputs } from "../../events";
import { dataProblem } from "../../output-schema";
import {
	type NodeAction,
	type NodeKind,
	PLAIN_KIND,
	type Requirement,
	type StepContext,
} from "../context";
import { RESUME_RULES } from "../resume-point";
import type { BodyEnd, StepHandle } from "../step-runner";
import { modelProducer } from "./producers/model";
import { ruleProducer } from "./producers/rule";

/**
 * The Value node, the twin of the Decision node: a Decision picks a label,
 * a Value makes `data` that matches the node's output schema, and who makes
 * it is `node.by`. The producer behind the seam makes the value; the step
 * runner (`runStep`) opens, ends and routes the step for it:
 *
 * - `rule`: `producers/rule.ts` evaluates the JSONata expression over the
 *   run's values, with no session and no cost; pure, so a re-run is safe.
 * - `model`: `producers/model.ts` asks the decider's text adapter for data
 *   held to the schema, and waits out a usage limit or a network failure at
 *   the node's wait node, like a Decision decided by a model.
 *
 * Every producer ends its step with `{ outcome, data, note, visit }`: `pass`
 * with the data, or `fail` with `data: null` and why in `note` (the
 * expression threw, the model failed, or the result does not match the
 * schema). `by: "person"` (a form in the Needs-you inbox) is left for later.
 */
export function valueNode(node: ValueNode, ctx: StepContext): NodeAction {
	return producerFor(node, ctx);
}

/**
 * A producer runs one visit of the node: it opens the step, makes the
 * value, ends the step and routes on it, or parks or waits instead. It
 * returns what the graph node returns.
 */
export type Producer = NodeAction;

function producerFor(node: ValueNode, ctx: StepContext): Producer {
	switch (node.by) {
		case "rule":
			return ruleProducer(node, ctx);
		case "model":
			return modelProducer(node, ctx);
	}
}

/** A Value made by a model needs a decider with a text adapter. */
export const modelValuesHaveDecider: Requirement<ValueNode> = (nodes, has) =>
	!has.decider?.values && nodes.some((n) => n.by === "model")
		? "The flow has a Value node made by a model, but no decider is configured."
		: null;

/**
 * The Value kind: the plain facts, with a wait node and the model's resume
 * rules when a model makes the value, and the decider as a requirement.
 */
export const VALUE: NodeKind<ValueNode> = {
	...PLAIN_KIND,
	type: "value",
	make: valueNode,
	resumeRules: (node) =>
		node.by === "model" ? RESUME_RULES.model : RESUME_RULES.fresh,
	aux: (node) => (node.by === "model" ? [{ kind: "wait" }] : []),
	requirements: [modelValuesHaveDecider],
};

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
 * matches the node's output schema, else `fail` with why in `note`. The
 * transcript gets the `value` entry either way.
 */
export function endWithValue(
	step: StepHandle,
	node: ValueNode,
	made: unknown,
	note: string,
	extra?: { costUsd?: number | null },
): BodyEnd {
	const problem = dataProblem(node.output, made);
	if (problem !== null) {
		return endWithoutValue(
			step,
			`The value does not match the output schema: ${problem}.`,
			extra,
		);
	}
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
	extra?: { costUsd?: number | null },
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
