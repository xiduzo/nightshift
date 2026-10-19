import { chooseByRule, type DecisionNode } from "@nightshift/flows";

import type { StepContext } from "../../context";
import { RESUME_RULES } from "../../resume-point";
import { runStep } from "../../step-runner";
import { type Chooser, decisionOutputs } from "../decision";

/**
 * A Decision decided by a rule: each option's `when` (a JSONata
 * expression over the run's values) is evaluated in order, and the first
 * that holds is the outcome; an option without a rule is the default. No
 * session, no cost, no wait: the step opens, decides and ends in one go,
 * and the transcript gets one `rule` entry with what each rule gave.
 *
 * It is pure: a step the daemon left open (it died between `StepStarted`
 * and `StepEnded`) is not continued; recovery ends it `interrupted` and
 * the node runs a new visit on the same values.
 *
 * No option matches → the step ends `error`. A rule that fails to parse or
 * to run → `error` with JSONata's message, naming the option.
 */
export function ruleChooser(node: DecisionNode, ctx: StepContext): Chooser {
	return (state, config) =>
		runStep(ctx, node, state, config, {
			rules: RESUME_RULES.fresh,
			outputs: (step) => decisionOutputs("", "", step.visit),
			async body(step) {
				const outcome = await chooseByRule(node.options, step.tctx);
				step.record(null, {
					type: "rule",
					matched: outcome.matched,
					evaluated: outcome.evaluated,
				});
				if (outcome.matched === null) {
					return {
						kind: "end",
						outcome: "error",
						outputs: decisionOutputs("error", "", step.visit),
						error:
							"No option matched: no rule held, and no option is without a rule.",
					};
				}
				return {
					kind: "end",
					outcome: outcome.matched,
					outputs: decisionOutputs(outcome.matched, "", step.visit),
					error: null,
				};
			},
		});
}
