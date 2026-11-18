import type { CostSource } from "@nightshift/agents/pricing";
import type { DecisionResult, ValueResult } from "@nightshift/agents/types";

import type { StepHandle } from "./step-runner";

/**
 * Where a decider's cost came from, for `StepEnded`. Null: it answered, but
 * its cost is not known. Undefined: it failed without a cost, which is
 * usually before it spent anything.
 */
export function deciderCostSource(
	result: DecisionResult | ValueResult,
): CostSource | null | undefined {
	if (result.costUsd !== null) {
		return (
			(result.kind === "error" ? undefined : result.costSource) ?? "reported"
		);
	}
	return result.kind === "error" ? undefined : null;
}

/** The sentence after the cause: what an unknown cost means for the person. */
const LEFT_OUT = "Spend totals leave it out.";

/** The warning for an Agent session that finished without a cost. */
export function sessionCostUnknown(
	harness: string,
	model: string | null,
	hadTokens: boolean,
): string {
	if (!hadTokens) {
		return `The cost of this step is not known. ${harness} reported no cost and no token counts. ${LEFT_OUT}`;
	}
	return model
		? `The cost of this step is not known. ${harness} reported no cost, and Night Shift has no price for "${model}". ${LEFT_OUT}`
		: `The cost of this step is not known. ${harness} reported no cost and no model. ${LEFT_OUT}`;
}

/** Warns when a decider answered without a cost: a Decision or a Value. */
export async function warnDeciderCost(
	step: Pick<StepHandle, "warn">,
	source: CostSource | null | undefined,
	what: "decision" | "value",
	model: string,
): Promise<void> {
	if (source !== null) return;
	await step.warn(
		"cost-unknown",
		`The cost of this ${what} is not known. Night Shift has no price for "${model}". ${LEFT_OUT}`,
	);
}
