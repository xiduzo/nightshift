import { describe, expect, test } from "bun:test";
import { parseInstant } from "@nightshift/time";
import type { RunRung, RunSummary } from "../read";
import { flowHealthRows, summarizeFlow } from "./flow-health";
import { flowLadders, flowRangeLadders } from "./ladders";

/**
 * Where the work of a flow landed: its runs' ladder rows added up per
 * ladder and rung, tiers of the same name merged over the nodes, and the
 * nodes that landed most. The clock is UTC and stands at 15:00.
 */

const HOUR = 60 * 60 * 1000;
const NOW = parseInstant("2026-10-21T15:00:00Z");
const TODAY = parseInstant("2026-10-21T00:00:00Z");
const DAY = 24 * HOUR;

/** One ladder row of a run: a work row on `agent` by default, at no cost. */
function rung(fields: Partial<RunRung> = {}): RunRung {
	return {
		ladder: "work",
		nodeId: "agent",
		rung: "first",
		by: "agent",
		tier: null,
		landed: 1,
		costUsd: 0,
		costEstimated: false,
		costMissing: 0,
		...fields,
	};
}

const decided = (fields: Partial<RunRung>) =>
	rung({ ladder: "choice", nodeId: "triage", picked: 0, unsure: 0, ...fields });

let next = 0;

function aRun(
	ladder: RunRung[] | undefined,
	fields: Partial<RunSummary> = {},
): RunSummary {
	next += 1;
	const walker = { id: "device-1", name: "this computer", thisDevice: true };
	return {
		id: `run-${next}`,
		projectId: "p1",
		walker,
		device: walker,
		trigger: { kind: "manual" },
		startedBy: null,
		flowName: "research",
		title: `Run ${next}`,
		worktreePath: "",
		branch: `nightshift/run-${next}`,
		baseRef: "main",
		status: "finished",
		reason: null,
		result: null,
		wakeAt: null,
		signal: null,
		inputs: {},
		stopAt: null,
		stopAfterStep: false,
		createdAt: NOW - HOUR,
		endedAt: NOW - HOUR / 2,
		costUsd: 0,
		costEstimated: false,
		costMissing: 0,
		costCalls: 1,
		warnings: [],
		subflows: [],
		gates: [],
		sleeps: [],
		...(ladder
			? {
					metrics: {
						wallMs: 1,
						agentMs: 1,
						gateWaitMs: 0,
						tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						costBasis: "billed" as const,
						prUrl: null,
						scores: [],
						ladder,
					},
				}
			: {}),
		...fields,
	};
}

describe("a flow's ladders", () => {
	test("merge a tier of the same name over the nodes, in ladder order", () => {
		const ladders = flowLadders([
			rung({
				nodeId: "draft",
				tier: "Sonnet",
				by: "agent",
				landed: 30,
				costUsd: 3,
			}),
			rung({
				nodeId: "check",
				tier: "Sonnet",
				by: "agent",
				landed: 2,
				costUsd: 1,
			}),
			// The same name later on another node: one rung, the lower one.
			rung({
				nodeId: "fix",
				tier: "Sonnet",
				rung: "later",
				landed: 1,
				costUsd: 0.2,
			}),
			rung({
				nodeId: "draft",
				tier: "Opus",
				rung: "later",
				landed: 6,
				costUsd: 4.2,
			}),
			rung({
				nodeId: "draft",
				tier: "You",
				rung: "person",
				by: "person",
				landed: 1,
				costUsd: 0.5,
			}),
			rung({
				nodeId: "check",
				tier: "Ask",
				rung: "person",
				by: "person",
				landed: 1,
			}),
			rung({
				nodeId: "draft",
				rung: "none",
				by: "agent",
				tier: "Opus",
				landed: 1,
				costUsd: 1,
			}),
			rung({ nodeId: "summary", landed: 2, costUsd: 0.4 }),
		]);

		expect(ladders.choice).toBeNull();
		expect(ladders.work?.landed).toBe(44);
		expect(
			ladders.work?.rungs.map(({ rung, by, tier, landed, costPerLanding }) => [
				rung,
				tier ?? by,
				landed,
				Number(costPerLanding.costUsd.toFixed(4)),
			]),
		).toEqual([
			["first", "Sonnet", 33, Number((4.2 / 33).toFixed(4))],
			["first", "agent", 2, 0.2],
			["later", "Opus", 6, 0.7],
			// Every person tier is you, whatever its name.
			["person", "person", 2, 0.25],
			["none", "agent", 1, 1],
		]);
	});

	test("count how sure the deciders were on the choice ladder", () => {
		const ladders = flowLadders([
			decided({ rung: "rule", by: "rule", landed: 40 }),
			decided({
				tier: "Small",
				by: "model",
				landed: 6,
				picked: 6,
				unsure: 0,
				costUsd: 0.06,
			}),
			decided({
				tier: "Large",
				rung: "later",
				by: "model",
				landed: 2,
				picked: 2,
				unsure: 2,
				costUsd: 0.1,
			}),
			decided({
				rung: "deadline",
				by: "person",
				tier: "You",
				landed: 1,
				picked: 1,
				unsure: 1,
			}),
			decided({
				rung: "person",
				by: "person",
				tier: "You",
				landed: 1,
				picked: 1,
				unsure: 1,
			}),
		]);

		expect(ladders.work).toBeNull();
		expect(ladders.choice).toMatchObject({ landed: 50, picked: 10, unsure: 4 });
		expect(ladders.choice?.rungs.map((row) => row.rung)).toEqual([
			"rule",
			"first",
			"later",
			"person",
			"deadline",
		]);
		// A rule decides for free.
		expect(ladders.choice?.rungs[0]?.costPerLanding).toEqual({
			costUsd: 0,
			costEstimated: false,
			costMissing: 0,
		});
	});

	test("keep a cost that is partly not known as such", () => {
		const ladders = flowLadders([
			rung({ tier: "Sonnet", landed: 2, costUsd: 1, costMissing: 1 }),
			rung({ tier: "Sonnet", landed: 2, costUsd: 3, costEstimated: true }),
		]);
		expect(ladders.work?.rungs[0]?.costPerLanding).toEqual({
			costUsd: 1,
			costEstimated: true,
			costMissing: 1,
		});
	});

	test("list the nodes that landed most, the nodes of a called flow apart", () => {
		const ladders = flowRangeLadders([
			rung({ nodeId: "draft", tier: "Sonnet", landed: 4, costUsd: 1 }),
			rung({
				nodeId: "draft",
				tier: "Opus",
				rung: "later",
				landed: 1,
				costUsd: 3,
			}),
			rung({ nodeId: "draft", via: "write", landed: 2, costUsd: 1 }),
			rung({ nodeId: "write", by: "flow", landed: 2, costUsd: 1 }),
			decided({ tier: "Small", by: "model", landed: 3, picked: 3, unsure: 1 }),
			rung({ nodeId: "a" }),
			rung({ nodeId: "b" }),
		]);

		expect(ladders.nodes.count).toBe(6);
		expect(
			ladders.nodes.rows.map(({ key, landed, costPerLanding }) => [
				key,
				landed,
				costPerLanding.costUsd,
			]),
		).toEqual([
			["work//draft", 5, 0.8],
			["choice//triage", 3, 0],
			["work/write/draft", 2, 0.5],
			["work//write", 2, 0.5],
			["work//a", 1, 0],
		]);
		expect(ladders.nodes.rows[1]).toMatchObject({ picked: 3, unsure: 1 });
		expect(ladders.nodes.rows[2]?.via).toBe("write");
		expect(ladders.nodes.rows[0]).not.toHaveProperty("picked");
	});
});

describe("Flow health", () => {
	test("counts only the flow's own runs, and nothing from a run that sent no ladder", () => {
		const runs = [
			aRun([rung({ tier: "Sonnet", landed: 2 })]),
			aRun([rung({ tier: "Opus", rung: "later" })]),
			// An older Host's run: no ladder rows.
			aRun(undefined),
			// The flow as a subflow: its landings are in the calling run.
			aRun([rung({ nodeId: "outer", landed: 5 })], {
				flowName: "outreach",
				subflows: [
					{
						flowName: "research",
						status: "finished",
						costUsd: 1,
						costEstimated: false,
						costMissing: 0,
						costCalls: 1,
						startedAt: NOW - HOUR,
						endedAt: NOW,
					},
				],
			}),
			// Older than the row's 30 days.
			aRun([rung({ tier: "Haiku" })], { createdAt: TODAY - 40 * DAY }),
		];

		const row = flowHealthRows(["research"], runs, NOW, "UTC").rows[0];
		expect(row?.ladders?.work?.landed).toBe(3);
		expect(row?.ladders?.work?.rungs.map((each) => each.tier)).toEqual([
			"Sonnet",
			"Opus",
		]);
		expect(row?.ladders).not.toHaveProperty("nodes");

		const ranges = summarizeFlow("research", runs, {
			now: NOW,
			timeZone: "UTC",
		}).ranges;
		expect(ranges.map((range) => range.ladders?.work?.landed)).toEqual([
			3, 3, 4,
		]);
		expect(ranges[0]?.ladders?.nodes.rows.map((node) => node.nodeId)).toEqual([
			"agent",
		]);
	});

	test("has empty ladders for a flow that did not run", () => {
		const row = flowHealthRows(["quiet"], [], NOW, "UTC").rows[0];
		expect(row?.ladders).toEqual({ work: null, choice: null });
	});
});

describe("a flow's days", () => {
	const score = (name: string, value: number) => ({
		score: name,
		value,
		label: null,
		stepId: null,
		at: NOW,
		by: null,
	});
	const scored = (scores: ReturnType<typeof score>[]) => ({
		wallMs: 1,
		agentMs: 1,
		gateWaitMs: 0,
		tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		costBasis: "billed" as const,
		prUrl: null,
		scores,
	});

	test("give per day what the runs spent, how often they needed you, and their metrics", () => {
		const runs = [
			aRun(undefined, {
				costUsd: 2,
				metrics: scored([
					score("leads", 3),
					score("leads", 1),
					score("useful", 1),
				]),
				neededYou: [{ reason: "gate", at: NOW }],
			}),
			aRun(undefined, {
				costUsd: 1,
				costMissing: 1,
				metrics: scored([score("leads", 2), score("gate_decision", 1)]),
			}),
			aRun(undefined, {
				createdAt: TODAY - DAY + HOUR,
				costUsd: 0.5,
				metrics: scored([score("accuracy", 0.9)]),
			}),
			// As a subflow: its spend counts, it has no metrics or needs of its own.
			aRun(undefined, {
				flowName: "outreach",
				subflows: [
					{
						flowName: "research",
						status: "failed",
						costUsd: 4,
						costEstimated: true,
						costMissing: 0,
						costCalls: 1,
						startedAt: NOW - HOUR,
						endedAt: NOW,
					},
				],
			}),
		];

		const week = summarizeFlow("research", runs, {
			now: NOW,
			timeZone: "UTC",
		}).ranges[0];
		const today = week?.perNight.at(-1);
		const yesterday = week?.perNight.at(-2);

		expect(week?.perNight).toHaveLength(7);
		expect(today).toEqual({
			night: TODAY,
			counts: { finished: 2, failed: 1 },
			spent: { costUsd: 7, costEstimated: true, costMissing: 1 },
			needed: { runs: 2, needed: 1 },
			metrics: { leads: { sum: 6, runs: 2 } },
		});
		expect(yesterday).toMatchObject({
			night: TODAY - DAY,
			counts: { finished: 1, failed: 0 },
			needed: { runs: 1, needed: 0 },
			metrics: { accuracy: { sum: 0.9, runs: 1 } },
		});
		expect(week?.perNight[0]).toMatchObject({
			counts: { finished: 0, failed: 0 },
			spent: { costUsd: 0, costEstimated: false, costMissing: 0 },
			needed: { runs: 0, needed: 0 },
			metrics: {},
		});
	});
});
