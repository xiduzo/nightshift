import {
	evaluateRule,
	type JsonValue,
	type ValueNode,
} from "@nightshift/flows";
import { messageOf, type StepContext } from "../../context";
import { schemaProblem } from "../../output-schema";
import { RESUME_RULES } from "../../resume-point";
import { runStep } from "../../step-runner";
import {
	endWithoutValue,
	endWithValue,
	type Producer,
	valueOutputs,
} from "../value";

/**
 * A Value made by a rule: the node's JSONata expression is evaluated over
 * the run's values (`ruleContext`, as a Decision's rule), and the result is
 * the value. No session, no cost, no wait: the step opens, evaluates and
 * ends in one go. The transcript gets `value-start` with the expression and
 * `value` with the data, or why there is none.
 *
 * It is pure: a step the daemon left open (it died between `StepStarted`
 * and `StepEnded`) is not continued; recovery ends it `interrupted` and
 * the node runs a new visit on the same values.
 *
 * The expression throws, or its result does not match the output schema →
 * `fail`, with why in `note`. An output schema that is not a valid JSON
 * Schema → `error`: that is the flow's mistake, not the run's.
 */
export function ruleProducer(node: ValueNode, ctx: StepContext): Producer {
	return (state, config) =>
		runStep(ctx, node, state, config, {
			rules: RESUME_RULES.fresh,
			outputs: (step) => valueOutputs("", null, "", step.visit),
			async body(step) {
				const expression = node.expression ?? "";
				step.record(null, {
					type: "value-start",
					by: "rule",
					source: expression,
					model: null,
				});
				const invalid = schemaProblem(node.output);
				if (invalid !== null) {
					return {
						kind: "end",
						outcome: "error",
						outputs: valueOutputs("error", null, "", step.visit),
						error: invalid,
					};
				}
				let result: JsonValue | undefined;
				try {
					result = await evaluateRule(expression, step.tctx);
				} catch (error) {
					return endWithoutValue(
						step,
						`The expression failed: ${ruleMessage(error)}`,
					);
				}
				return endWithValue(step, node, plainJson(result), "");
			},
		});
}

/** JSONata throws plain objects with a `message`, not Errors. */
function ruleMessage(error: unknown): string {
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}
	return messageOf(error);
}

/**
 * JSONata's result as plain JSON: no result is null, and a sequence (an
 * array with JSONata's own markers) becomes an ordinary array.
 */
function plainJson(result: JsonValue | undefined): JsonValue | null {
	if (result === undefined) return null;
	return JSON.parse(JSON.stringify(result)) as JsonValue;
}
