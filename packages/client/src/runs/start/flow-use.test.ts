import { describe, expect, test } from "bun:test";

import { rankFlowsByUse } from "./flow-use";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;
const run = (
	flowName: string | null,
	daysAgo: number,
	kind: "manual" | "schedule" = "manual",
) => ({ flowName, createdAt: NOW - daysAgo * DAY, trigger: { kind } });

describe("rankFlowsByUse", () => {
	test("manual starts first, then all runs, then the name", () => {
		const ranked = rankFlowsByUse(
			["b", "a", "night", "triage"],
			[
				run("night", 1, "schedule"),
				run("night", 2, "schedule"),
				run("night", 3, "schedule"),
				run("triage", 1),
				run("b", 4, "schedule"),
			],
			NOW,
		);
		expect(ranked.map((flow) => flow.name)).toEqual([
			"triage",
			"night",
			"b",
			"a",
		]);
		expect(ranked[1]?.use).toEqual({ manual: 0, runs: 3 });
	});

	test("runs before the window and quick runs do not count", () => {
		const ranked = rankFlowsByUse(
			["a", "b"],
			[run("b", 40), run(null, 1)],
			NOW,
		);
		expect(ranked).toEqual([
			{ name: "a", use: { manual: 0, runs: 0 } },
			{ name: "b", use: { manual: 0, runs: 0 } },
		]);
	});
});
