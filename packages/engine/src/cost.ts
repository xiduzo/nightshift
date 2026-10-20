import type { DerivedSession } from "./derive-steps";
import type { EnginePayloads } from "./events";

/**
 * Cost arithmetic of the read model: what a session, a step and a run cost,
 * as far as the event log knows it.
 */

/**
 * What something cost, as far as it is known: the reported and estimated
 * dollars, whether part of them is an estimate, how many sessions or model
 * calls ended without a cost (their spend is not in `usd`), and how many
 * ended or spent so far. With no calls, nothing could cost.
 */
export type CostTally = {
	usd: number;
	estimated: boolean;
	missing: number;
	calls: number;
};

export const NO_COST: CostTally = {
	usd: 0,
	estimated: false,
	missing: 0,
	calls: 0,
};

export function addCost(a: CostTally, b: CostTally): CostTally {
	return {
		usd: a.usd + b.usd,
		estimated: a.estimated || b.estimated,
		missing: a.missing + b.missing,
		calls: a.calls + b.calls,
	};
}

/**
 * A session's cost: its final cost, else what it spent so far (it still
 * runs, failed, or Night Shift stopped during it). A finished session
 * without either is missing: it did work. A session that failed without
 * usage spent what nobody knows, usually nothing, so it does not count.
 */
export function sessionCost(
	session: Pick<DerivedSession, "ending" | "spent">,
): CostTally {
	const { ending, spent } = session;
	const known =
		ending?.costUsd != null ? ending : spent?.costUsd != null ? spent : null;
	if (known?.costUsd != null) {
		return {
			usd: known.costUsd,
			estimated: known.costSource === "estimated",
			missing: 0,
			calls: 1,
		};
	}
	if (!ending) return NO_COST;
	return {
		...NO_COST,
		missing: ending.outcome === "finished" ? 1 : 0,
		calls: 1,
	};
}

/** What a step spent outside sessions (a decider), from its `StepEnded`. */
export function stepEndCost(payload: EnginePayloads["StepEnded"]): CostTally {
	if (payload.costUsd == null) {
		// Absent: nothing was asked. Null: the decider answered without a cost.
		return payload.costSource === null
			? { ...NO_COST, missing: 1, calls: 1 }
			: NO_COST;
	}
	return {
		usd: payload.costUsd,
		estimated: payload.costSource === "estimated",
		missing: 0,
		calls: 1,
	};
}
