import type { ResolvedPolicy } from "@nightshift/flows";

/**
 * The settings the walk reads when they apply: how many runs walk at once,
 * the most steps, spend and turns of a run, and the policy's defaults.
 * The settings of this computer (`RunSettings` of `device-config`) have
 * these fields, so the engine hands those over as they are.
 */
export type WalkSettings = {
	maxConcurrentRuns: number;
	maxStepsPerRun: number;
	/** The most a run may spend, in USD, unless its flow sets its own. Null: no budget. */
	budgetUsd: number | null;
	/** The most turns one Agent session may take, unless the flow or the node sets its own. Null: no limit. */
	maxTurns: number | null;
	/** The defaults of a flow's policy: the waits and the idle time. */
	policy: Omit<
		ResolvedPolicy,
		"maxSteps" | "resumeInterruptedRuns" | "budgetUsd" | "maxTurns"
	>;
};
