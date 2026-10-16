import { chooseByRule, type DecisionNode } from "@nightshift/flows";

import { beginStep, messageOf, type StepContext } from "../../context";
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
	return async (state, config) => {
		const begun = await beginStep(ctx, node, state, config, { kind: "new" });
		if (begun.kind === "parked") return begun.command;
		const step = begun.step;
		const { visit } = step;
		try {
			const outcome = await chooseByRule(node.options, step.tctx);
			step.record(null, {
				type: "rule",
				matched: outcome.matched,
				evaluated: outcome.evaluated,
			});
			if (outcome.matched === null) {
				return step.end(
					"error",
					decisionOutputs("error", "", visit),
					"No option matched: no rule held, and no option is without a rule.",
				);
			}
			return step.end(
				outcome.matched,
				decisionOutputs(outcome.matched, "", visit),
				null,
			);
		} catch (error) {
			return step.end(
				"error",
				decisionOutputs("error", "", visit),
				messageOf(error),
			);
		}
	};
}
