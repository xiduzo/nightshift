/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { RunSummary } from "@nightshift/client";

import { stoppedFacts, stoppedOptions } from "./stopped-view";

const MIN = 60_000;

function run(fields: Partial<RunSummary>): RunSummary {
	return {
		id: "r1",
		status: "failed",
		result: null,
		reason: null,
		wakeAt: null,
		signal: null,
		walker: { thisDevice: true, name: null },
		flowName: "Daily digest",
		createdAt: 0,
		endedAt: 14 * MIN,
		...fields,
	} as RunSummary;
}

const time = (at: number) => `t${at / MIN}`;

describe("stoppedOptions", () => {
	test("a run that failed: Retry in green, then Leave it in gray", () => {
		const options = stoppedOptions(run({}));
		expect(options.map((option) => [option.name, option.color])).toEqual([
			["Retry", "green"],
			["Leave it", "gray"],
		]);
		expect(options[0]?.act).toBe("Retry run");
	});

	test("a run that stopped resumes", () => {
		const [first] = stoppedOptions(run({ status: "stopped" }));
		expect(first?.name).toBe("Resume");
		expect(first?.do).toBe("retry");
	});
});

describe("stoppedFacts", () => {
	test("where it is from, when it stopped and how long it ran", () => {
		expect(
			stoppedFacts(run({}), {
				projectName: "Research",
				statusLabel: "Failed",
				time,
			}),
		).toBe("Research · Daily digest · Failed at t14 · Ran for 14 min");
	});

	test("a part that is not known stays out", () => {
		expect(
			stoppedFacts(run({ flowName: null, endedAt: null }), {
				projectName: null,
				statusLabel: "Stopped",
				time,
			}),
		).toBe("Stopped at t0");
	});
});
