import type { Policy, ResolvedPolicy } from "@nightshift/flows";
import type { RunSettings } from "../device-config";
import type { PolicyWaitReason } from "../log";

/** The flow's own policy numbers, else the daemon's settings. */
export function resolvePolicy(
	own: Policy | undefined,
	defaults: RunSettings["policy"],
): ResolvedPolicy {
	return {
		usageLimitFirstWaitMinutes:
			own?.usageLimitFirstWaitMinutes ?? defaults.usageLimitFirstWaitMinutes,
		usageLimitMaxWaitMinutes:
			own?.usageLimitMaxWaitMinutes ?? defaults.usageLimitMaxWaitMinutes,
		networkGraceMinutes:
			own?.networkGraceMinutes ?? defaults.networkGraceMinutes,
		idleMinutes: own?.idleMinutes ?? defaults.idleMinutes,
		...(own?.maxSteps !== undefined ? { maxSteps: own.maxSteps } : {}),
		...(own?.budgetUsd !== undefined ? { budgetUsd: own.budgetUsd } : {}),
		...(own?.maxTurns !== undefined ? { maxTurns: own.maxTurns } : {}),
	};
}

/**
 * The run policy's waits, ported from night-shift.py. A usage limit waits
 * until the reset (plus a minute) when the harness knows it, else 5, 10,
 * 20, … minutes up to the max. A network failure waits 1, 2, 5, 10, 15
 * minutes (the last one repeats) until the total since the first failure
 * would pass the grace; then the step fails.
 */

/** The waits after a network failure, in minutes. The last one repeats. */
export const NETWORK_WAITS_MINUTES = [1, 2, 5, 10, 15] as const;

export type WaitPlan =
	| { kind: "wait"; until: number; since: number; message: string }
	| { kind: "give-up"; error: string };

/** The earlier waits of a step for one reason: how many, and when the first began. */
export type WaitStreak = { count: number; since: number };

export function planWait(input: {
	reason: PolicyWaitReason;
	/** The earlier waits of this streak; null for the first. */
	streak: WaitStreak | null;
	/** The harness's error message. */
	message: string;
	resetAt: number | null;
	policy: ResolvedPolicy;
	now: number;
	minuteMs: number;
}): WaitPlan {
	const { reason, policy, now, minuteMs } = input;
	const earlier = input.streak?.count ?? 0;
	const since = input.streak?.since ?? now;
	if (reason === "usage-limit") {
		if (input.resetAt !== null) {
			const until = Math.max(input.resetAt + minuteMs, now);
			return {
				kind: "wait",
				until,
				since,
				message: `Usage limit: ${input.message}. The step continues a minute after the reset.`,
			};
		}
		const minutes = Math.min(
			policy.usageLimitFirstWaitMinutes * 2 ** earlier,
			policy.usageLimitMaxWaitMinutes,
		);
		return {
			kind: "wait",
			until: now + minutes * minuteMs,
			since,
			message: `Usage limit: ${input.message}. The step continues in ${minutes} min.`,
		};
	}
	const minutes =
		NETWORK_WAITS_MINUTES[
			Math.min(earlier, NETWORK_WAITS_MINUTES.length - 1)
		] ?? 15;
	const pause = minutes * minuteMs;
	if (now - since + pause > policy.networkGraceMinutes * minuteMs) {
		return {
			kind: "give-up",
			error: `The network did not come back within the grace of ${policy.networkGraceMinutes} min: ${input.message}`,
		};
	}
	return {
		kind: "wait",
		until: now + pause,
		since,
		message: `Network: ${input.message}. The step continues in ${minutes} min.`,
	};
}
