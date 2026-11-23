import type { ResolvedPolicy } from "@nightshift/flows";
import { DEFS, type Settings } from "./setting-defs";

/** The settings the engine reads when they apply. */
export type RunSettings = Pick<
	Settings,
	| "scheduler"
	| "maxConcurrentRuns"
	| "maxStepsPerRun"
	| "budgetUsd"
	| "maxTurns"
	| "resumeInterruptedRuns"
	| "cleanUpRuns"
	| "cleanUpAfterDays"
> & {
	policy: Omit<
		ResolvedPolicy,
		"maxSteps" | "resumeInterruptedRuns" | "budgetUsd" | "maxTurns"
	>;
};

/** The engine's part of the current values. */
export function runSettingsOf(s: Settings): RunSettings {
	return {
		scheduler: s.scheduler,
		maxConcurrentRuns: s.maxConcurrentRuns,
		maxStepsPerRun: s.maxStepsPerRun,
		budgetUsd: s.budgetUsd,
		maxTurns: s.maxTurns,
		resumeInterruptedRuns: s.resumeInterruptedRuns,
		cleanUpRuns: s.cleanUpRuns,
		cleanUpAfterDays: s.cleanUpAfterDays,
		policy: {
			usageLimitFirstWaitMinutes: s.usageLimitFirstWaitMinutes,
			usageLimitMaxWaitMinutes: s.usageLimitMaxWaitMinutes,
			networkGraceMinutes: s.networkGraceMinutes,
			idleMinutes: s.idleMinutes,
		},
	};
}

/** The built-in defaults, for an engine without a settings store. */
export function defaultRunSettings(): RunSettings {
	return {
		scheduler: DEFS.scheduler.default,
		maxConcurrentRuns: DEFS.maxConcurrentRuns.default,
		maxStepsPerRun: DEFS.maxStepsPerRun.default,
		budgetUsd: DEFS.budgetUsd.default,
		maxTurns: DEFS.maxTurns.default,
		resumeInterruptedRuns: DEFS.resumeInterruptedRuns.default,
		cleanUpRuns: DEFS.cleanUpRuns.default,
		cleanUpAfterDays: DEFS.cleanUpAfterDays.default,
		policy: {
			usageLimitFirstWaitMinutes: DEFS.usageLimitFirstWaitMinutes.default,
			usageLimitMaxWaitMinutes: DEFS.usageLimitMaxWaitMinutes.default,
			networkGraceMinutes: DEFS.networkGraceMinutes.default,
			idleMinutes: DEFS.idleMinutes.default,
		},
	};
}
