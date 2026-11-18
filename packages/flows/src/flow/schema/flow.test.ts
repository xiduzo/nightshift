import { describe, expect, test } from "bun:test";
import { DEFAULT_POLICY, policyFromSettings } from "./flow";

describe("policyFromSettings", () => {
	test("a flow without its own policy runs by the daemon's settings", () => {
		expect(
			policyFromSettings({
				usageLimitFirstWaitMinutes: 10,
				usageLimitMaxWaitMinutes: 90,
				networkGraceMinutes: 30,
				maxStepsPerRun: 50,
				resumeInterruptedRuns: false,
				budgetUsd: 5,
				maxTurns: null,
				idleMinutes: 20,
			}),
		).toEqual({
			usageLimitFirstWaitMinutes: 10,
			usageLimitMaxWaitMinutes: 90,
			networkGraceMinutes: 30,
			maxSteps: 50,
			resumeInterruptedRuns: false,
			budgetUsd: 5,
			maxTurns: null,
			idleMinutes: 20,
		});
	});

	test("settings at their defaults give the built-in policy", () => {
		expect(
			policyFromSettings({
				...DEFAULT_POLICY,
				maxStepsPerRun: DEFAULT_POLICY.maxSteps,
			}),
		).toEqual({ ...DEFAULT_POLICY });
	});
});
