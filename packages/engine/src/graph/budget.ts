import type { AgentNode } from "@nightshift/flows";
import type { StepContext } from "./context";
import { type GuardTrip, LOOP_REPEATS } from "./session-guards";

/**
 * The numbers of the run budget and the turn limit, as the run policy
 * resolves them, and the sentences their guards end a step or a run with.
 * The flow sets the numbers (`policy.budgetUsd`, `policy.maxTurns`, an
 * Agent node's `maxTurns`); the daemon's settings give the defaults.
 */

/** The run's budget in USD: the flow's own, else the daemon's setting. Null: none. */
export function runBudget(
	ctx: Pick<StepContext, "policy" | "settings">,
): number | null {
	return ctx.policy().budgetUsd ?? ctx.settings().budgetUsd ?? null;
}

/** The turn limit of each session of an Agent step: the node's, else the policy's. Null: none. */
export function turnLimit(
	ctx: Pick<StepContext, "policy" | "settings">,
	node: AgentNode,
): number | null {
	return (
		node.maxTurns ?? ctx.policy().maxTurns ?? ctx.settings().maxTurns ?? null
	);
}

/** Dollars as a person reads them: $5.00. */
function usd(amount: number): string {
	return `$${amount.toFixed(2)}`;
}

/**
 * Why the run stopped at its budget: what it spent against it. `before`:
 * the node it stopped before, when it stopped between steps.
 */
export function budgetPassed(
	budgetUsd: number,
	spentUsd: number,
	before?: string,
): string {
	const where = before === undefined ? "" : ` before node "${before}"`;
	return `The run spent ${usd(spentUsd)} of its ${usd(budgetUsd)} budget, so it stopped${where}. Resume it to spend up to ${usd(budgetUsd)} more.`;
}

/** Why a session's guard ended the step. */
export function guardMessage(trip: GuardTrip): string {
	return trip.kind === "turns"
		? `The agent reached its limit of ${trip.limit} turns, so the step stopped.`
		: `The agent called ${trip.tool} ${LOOP_REPEATS} times in a row with the same input, so the step stopped.`;
}
