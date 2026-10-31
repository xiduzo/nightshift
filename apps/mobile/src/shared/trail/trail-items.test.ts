/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { StepSummary } from "@nightshift/client";

import { trailItemLabel, trailItemOf } from "./trail-items";

const MIN = 60_000;

function step(fields: Partial<StepSummary>): StepSummary {
	return {
		id: "s1",
		nodeId: "build",
		nodeType: "agent",
		visit: 1,
		startedAt: 0,
		endedAt: 4 * MIN,
		outcome: "pass",
		outputs: {},
		error: null,
		scope: null,
		items: [],
		sessions: [],
		costUsd: 0.12,
		costEstimated: false,
		costMissing: 0,
		costCalls: 1,
		device: null,
		gate: null,
		...fields,
	} as StepSummary;
}

const labels = new Map([
	["build", "Build"],
	["ship", "Ship it?"],
]);

describe("trailItemOf", () => {
	test("an ended step: its kind, name, outcome, time and cost", () => {
		const item = trailItemOf(step({}), { labels, now: 10 * MIN });
		expect(item.kind).toEqual({ label: "Agent", icon: "bot" });
		expect(item.label).toBe("Build");
		expect(item.look.label).toBe("Pass");
		expect(item.meta).toBe("4 min · $0.12");
		expect(item.waiting).toBe(false);
		expect(trailItemLabel(item)).toBe("Agent step Build, Pass, 4 min, $0.12");
	});

	test("an agent step with tokens: time, tokens and cost", () => {
		const metrics = {
			wallMs: 4 * MIN,
			agentMs: 4 * MIN,
			gateWaitMs: 0,
			tokens: { input: 40_000, output: 2_100, cacheRead: 0, cacheWrite: 0 },
			costBasis: "billed",
			prUrl: null,
		} as StepSummary["metrics"];
		const item = trailItemOf(step({ metrics }), { labels, now: 10 * MIN });
		expect(item.meta).toBe("4 min · 42.1K tokens · $0.12");
		expect(trailItemLabel(item)).toBe(
			"Agent step Build, Pass, 4 min, 42.1K tokens, $0.12",
		);
	});

	test("an open Gate waits since it started", () => {
		const item = trailItemOf(
			step({
				nodeId: "ship",
				nodeType: "decision",
				endedAt: null,
				outcome: null,
				costUsd: 0,
				costCalls: 0,
				gate: {
					question: "Ship it?",
					choices: [],
					openedAt: 0,
					deadline: null,
				},
			}),
			{ labels, now: 12 * MIN },
		);
		expect(item.kind.label).toBe("Gate");
		expect(item.look.label).toBe("Waiting for you");
		expect(item.meta).toBe("Waiting 12 min");
		expect(item.waiting).toBe(true);
	});

	test("a failed step shows its error, and a second visit its number", () => {
		const item = trailItemOf(
			step({
				error: "Tests failed",
				outcome: null,
				visit: 2,
				costCalls: 0,
				costUsd: 0,
			}),
			{ labels, now: 10 * MIN },
		);
		expect(item.label).toBe("Build (visit 2)");
		expect(item.look.tone).toBe("failed");
		expect(item.detail).toBe("Tests failed");
		expect(item.meta).toBe("4 min");
	});

	test("a running step in a sleeping run sleeps", () => {
		const item = trailItemOf(
			step({ nodeType: "wait", endedAt: null, outcome: null }),
			{ labels, runStatus: "sleeping", now: 2 * MIN },
		);
		expect(item.look.tone).toBe("sleeping");
		expect(item.meta).toBe("2 min · $0.12");
	});
});
