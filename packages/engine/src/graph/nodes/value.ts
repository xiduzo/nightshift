import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { Command } from "@langchain/langgraph";
import type { JsonValue, ValueNode } from "@nightshift/flows";
import type { StepOutputs } from "../../events";
import { dataProblem } from "../../output-schema";
import type { NodeAction, StepContext, StepHandle } from "../context";
import { route, type StepEnd } from "../route";
import type { RunStateValues } from "../state";
import { modelProducer } from "./producers/model";
import { ruleProducer } from "./producers/rule";

/**
 * The Value node, the twin of the Decision node: a Decision picks a label,
 * a Value makes `data` that matches the node's output schema, and who makes
 * it is `node.by`. The node routes on the step's end (`route()`); the
 * producer behind the seam makes the value:
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
	const produce = producerFor(node, ctx);
	return async (state, config) => {
		const made = await produce(state, config);
		if (made instanceof Command) return made;
		return route(ctx, state, node, made, config);
	};
}

/**
 * A producer runs one visit of the node: it opens the step, makes the
 * value, and ends the step. It returns the step's end to route on, or a
 * Command when the run parks or waits instead.
 */
export type Producer = (
	state: RunStateValues,
	config: LangGraphRunnableConfig,
) => Promise<StepEnd | Command>;

function producerFor(node: ValueNode, ctx: StepContext): Producer {
	switch (node.by) {
		case "rule":
			return ruleProducer(node, ctx);
		case "model":
			return modelProducer(node, ctx);
	}
}

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
 * Ends the step with the value made: `pass` with the data when it matches
 * the node's output schema, else `fail` with why in `note`. The transcript
 * gets the `value` entry either way.
 */
export function endWithValue(
	step: StepHandle,
	node: ValueNode,
	made: unknown,
	note: string,
	extra?: { costUsd?: number | null },
): Promise<StepEnd> {
	const problem = dataProblem(node.output, made);
	if (problem !== null) {
		const why = `The value does not match the output schema: ${problem}.`;
		step.record(null, { type: "value", data: null, problem: why });
		return step.end(
			"fail",
			valueOutputs("fail", null, why, step.visit),
			null,
			extra,
		);
	}
	const data = made as JsonValue;
	step.record(null, { type: "value", data, problem: null });
	return step.end(
		"pass",
		valueOutputs("pass", data, note, step.visit),
		null,
		extra,
	);
}

/** Ends the step `fail` without a value, with why in `note` and the transcript. */
export function endWithoutValue(
	step: StepHandle,
	why: string,
	extra?: { costUsd?: number | null },
): Promise<StepEnd> {
	step.record(null, { type: "value", data: null, problem: why });
	return step.end(
		"fail",
		valueOutputs("fail", null, why, step.visit),
		null,
		extra,
	);
}
