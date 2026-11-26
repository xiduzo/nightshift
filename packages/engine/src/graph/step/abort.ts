import type { FlowNode } from "@nightshift/flows";
import type { StepOutputs } from "../../log";
import { OUTRUN_ERROR } from "../../read";
import type { StepContext } from "../context";
import type { StepEnd } from "../route";
import type { AbortReason } from "./step-handle";

/**
 * The end of a step whose signal aborted: the words of a time budget, and
 * the outcome each reason gives (`abortEnd`).
 */

/** Why a step ran out of time: its end's error. `minutes` is the limit it ran past. */
export function budgetError(
	reason: "timeout" | "idle",
	minutes: number | undefined,
): string {
	return reason === "timeout"
		? `The step ran past its time budget of ${minutes} min.`
		: `The agent showed no activity for ${minutes} min, so the step stopped.`;
}

/**
 * The end an aborted step has, from its signal's reason: `error` with why
 * for the node's time budget; `fail` with why for a guard of the run
 * policy (no activity, a turn limit, a loop, the budget: `halted` has its
 * message); else `stopped` (a person stopped the run, or another branch
 * outran this one, which the error says). The outputs the body had so far
 * are kept.
 */
export function abortEnd(
	ctx: StepContext,
	node: FlowNode,
	signal: AbortSignal,
	outputs: StepOutputs,
): Pick<StepEnd, "outputs" | "error"> & {
	outcome: "error" | "fail" | "stopped";
} {
	const reason = signal.reason as AbortReason | undefined;
	const budget = () => ctx.kindOf(node).timeBudget(node, ctx.policy());
	if (reason === "timeout") {
		return {
			outcome: "error",
			outputs: { ...outputs, outcome: "error" },
			error: budgetError(reason, budget().timeoutMinutes),
		};
	}
	if (reason === "idle") {
		return {
			outcome: "fail",
			outputs: { ...outputs, outcome: "fail" },
			error: budgetError(reason, budget().idleMinutes),
		};
	}
	if (reason === "budget" || reason === "turns" || reason === "looping") {
		return {
			outcome: "fail",
			outputs: { ...outputs, outcome: "fail" },
			error: haltMessages.get(signal) ?? null,
		};
	}
	return {
		outcome: "stopped",
		outputs: { ...outputs, outcome: "stopped" },
		error: reason === "outrun" ? OUTRUN_ERROR : null,
	};
}

/** The message of the guard each halted step's signal aborted for (`StepHandle.halt`). */
export const haltMessages = new WeakMap<AbortSignal, string>();
