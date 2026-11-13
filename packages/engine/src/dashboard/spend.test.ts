import { describe, expect, test } from "bun:test";
import { parseInstant } from "@nightshift/time";
import type { AnswerCost } from "../assistant";
import type { RunRung, RunSummary } from "../read";
import { steadinessOf, summarizeSpend } from "./spend";
import { spreadOf } from "./stats";

/*
 * The Spend page: what the runs cost, how steady the cost of a flow is,
 * and the ways to save. The clock is UTC and stands at 15:00.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = parseInstant("2026-10-21T15:00:00Z");

let next = 0;

function aRun(fields: Partial<RunSummary> = {}): RunSummary {
	next += 1;
	const walker = { id: "device-1", name: "this computer", thisDevice: true };
	return {
		id: `run-${next}`,
		projectId: "p1",
		walker,
		device: walker,
		trigger: { kind: "manual" },
		startedBy: null,
		flowName: "night",
		title: `Run ${next}`,
		worktreePath: "",
		branch: `nightshift/run-${next}`,
		baseRef: "main",
		status: "finished",
		reason: null,
		result: "done",
		wakeAt: null,
		signal: null,
		inputs: {},
		stopAt: null,
		stopAfterStep: false,
		createdAt: NOW - HOUR,
		endedAt: NOW,
		costUsd: 1,
		costEstimated: false,
		costMissing: 0,
		costCalls: 1,
		warnings: [],
		subflows: [],
		gates: [],
		sleeps: [],
		...fields,
	};
}

/** A run that cost `costUsd`, `daysAgo` days ago. */
const cost = (costUsd: number, daysAgo = 0, more: Partial<RunSummary> = {}) =>
	aRun({ costUsd, createdAt: NOW - HOUR - daysAgo * DAY, ...more });

const landed = (nodeId: string, costUsd: number, times = 1): RunRung => ({
	ladder: "work",
	nodeId,
	rung: "first",
	by: "agent",
	tier: null,
	landed: times,
	costUsd,
	costEstimated: false,
	costMissing: 0,
});

/** A run whose steps cost what `nodes` says. */
const withSteps = (
	nodes: Record<string, number>,
	more: Partial<RunSummary> = {},
) =>
	aRun({
		costUsd: Object.values(nodes).reduce((sum, usd) => sum + usd, 0),
		metrics: {
			wallMs: null,
			agentMs: 0,
			gateWaitMs: 0,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			costBasis: "billed",
			prUrl: null,
			ladder: Object.entries(nodes).map(([nodeId, usd]) => landed(nodeId, usd)),
		},
		...more,
	});

function spend(runs: RunSummary[], days: 7 | 30 | 90 = 7) {
	const range = summarizeSpend(runs, { now: NOW, timeZone: "UTC" }).ranges.find(
		(r) => r.nights === days,
	);
	if (!range) throw new Error(`no range of ${days} days`);
	return range;
}

describe("how steady the cost of a flow is", () => {
	const of = (costs: number[]) => steadinessOf(spreadOf(costs));

	test("too few runs give none", () => {
		expect(of([1, 1])).toBeNull();
		expect(steadinessOf(null)).toBeNull();
	});

	test("the middle half within 20% of a usual run: steady", () => {
		expect(of([0.9, 1, 1, 1.1, 1.3])).toBe("steady");
	});

	test("a wider middle half: varies", () => {
		expect(of([0.5, 0.6, 1, 1.5, 1.8])).toBe("varies");
	});

	test("one run over twice a usual run is not steady", () => {
		expect(of([1, 1, 1, 1, 1, 1, 1, 1, 2.5])).toBe("varies");
	});

	test("one run over four times a usual run: unsteady", () => {
		expect(of([1, 1, 1, 1, 1, 1, 1, 1, 6])).toBe("unsteady");
	});

	test("a quarter of the runs over twice a usual run: unsteady", () => {
		expect(of([1, 1, 1, 3, 3])).toBe("unsteady");
	});
});

describe("what the runs cost", () => {
	test("the total holds every run of the days, against the days before", () => {
		const range = spend([cost(2), cost(3, 1), cost(5, 8), cost(7, 20)]);
		expect(range.total).toBe(5);
		expect(range.before).toBe(5);
		expect(range.runs).toBe(2);
		expect(range.perNight.at(-1)).toMatchObject({ costUsd: 2 });
		expect(range.perNight.at(-2)).toMatchObject({ costUsd: 3 });
	});

	test("the flows and the quick runs add up to the total", () => {
		const range = spend([
			cost(2),
			cost(3, 0, { flowName: "day" }),
			cost(4, 0, { flowName: "night", projectId: "p2" }),
			cost(1, 0, { flowName: null }),
		]);
		expect(range.flows.map((flow) => [flow.key, flow.spent])).toEqual([
			["p2/night", 4],
			["p1/day", 3],
			["p1/night", 2],
		]);
		expect(range.quick).toEqual({ runs: 1, spent: 1 });
		expect(range.total).toBe(10);
	});

	test("a test run counts in the spend, not in a usual run", () => {
		const range = spend([
			cost(1),
			cost(9, 0, { test: { pinned: ["a"], skipped: [] } }),
		]);
		expect(range.flows[0]).toMatchObject({ runs: 2, spent: 10 });
		expect(range.flows[0]?.usual).toMatchObject({ count: 1, median: 1 });
	});

	test("the steps of a flow: per run, the most in one run, the dearest first", () => {
		const range = spend([
			withSteps({ plan: 1, build: 3 }),
			withSteps({ plan: 1, build: 5 }),
		]);
		expect(range.flows[0]?.steps).toEqual([
			{ key: "/build", nodeId: "build", perRun: 4, most: 5, timesPerRun: 1 },
			{ key: "/plan", nodeId: "plan", perRun: 1, most: 1, timesPerRun: 1 },
		]);
	});
});

describe("the ways to save", () => {
	test("runs that did not finish: what they spent", () => {
		const failed = cost(4, 1, { status: "failed" });
		const range = spend([cost(1), failed, cost(2, 2, { status: "stopped" })]);
		expect(range.savings).toEqual([
			{
				key: "p1/night/unfinished",
				kind: "unfinished",
				projectId: "p1",
				flow: "night",
				saves: 6,
				runs: 2,
				of: 3,
				runId: failed.id,
			},
		]);
		expect(range.saves).toBe(6);
		expect(range.flows[0]?.saves).toBe(6);
		expect(range.perNight.at(-2)).toMatchObject({ costUsd: 4, saves: 4 });
	});

	test("one run with nothing to do is no way to save, two are", () => {
		const nothing = { result: "nothing-to-do" } as const;
		expect(spend([cost(1), cost(1, 1, nothing)]).savings).toEqual([]);
		const range = spend([cost(1), cost(1, 1, nothing), cost(2, 2, nothing)]);
		expect(range.savings).toMatchObject([
			{ kind: "nothing", saves: 3, runs: 2, of: 3 },
		]);
	});

	test("a costly run saves what it cost above a usual run, and names its step", () => {
		const usual = Array.from({ length: 5 }, (_, day) =>
			withSteps({ plan: 1, check: 1 }, { createdAt: NOW - HOUR - day * DAY }),
		);
		const dear = withSteps({ plan: 1, check: 9 });
		const range = spend([...usual, dear]);
		expect(range.savings).toEqual([
			{
				key: "p1/night/costly",
				kind: "costly",
				projectId: "p1",
				flow: "night",
				saves: 8,
				runs: 1,
				of: 6,
				runId: dear.id,
				step: { nodeId: "check" },
			},
		]);
	});

	test("with few runs no run is costly", () => {
		expect(spend([cost(1), cost(1, 1), cost(9, 2)]).savings).toEqual([]);
	});

	test("a test run is no way to save", () => {
		const test = { pinned: [], skipped: ["a"] };
		expect(
			spend([cost(1), cost(4, 1, { status: "failed", test })]).savings,
		).toEqual([]);
	});

	test("the most saved comes first", () => {
		const range = spend([
			cost(1, 0, { status: "failed" }),
			cost(5, 0, { status: "failed", flowName: "day" }),
		]);
		expect(range.savings.map((saving) => saving.flow)).toEqual([
			"day",
			"night",
		]);
	});
});

/** An answer of a built-in agent that cost `costUsd`, `daysAgo` days ago. */
const answer = (
	agent: AnswerCost["agent"],
	costUsd: number | null,
	daysAgo = 0,
): AnswerCost => ({
	at: NOW - HOUR - daysAgo * DAY,
	agent,
	entry: null,
	projectId: "p1",
	spaceId: "space",
	personId: "ada",
	inputTokens: 100,
	outputTokens: 10,
	costUsd,
});

describe("what help cost", () => {
	const summarize = (help: AnswerCost[], runs: RunSummary[] = []) =>
		summarizeSpend(runs, { now: NOW, timeZone: "UTC", help });
	const days = (spend: ReturnType<typeof summarize>, nights: number) =>
		spend.ranges.find((range) => range.nights === nights)?.help;

	test("without answers, help cost nothing", () => {
		const spend = summarizeSpend([cost(1)], { now: NOW, timeZone: "UTC" });
		expect(days(spend, 7)).toEqual({
			total: 0,
			answers: 0,
			unknown: 0,
			agents: [],
		});
		expect(spend.helpThisMonth).toBe(0);
	});

	test("the total of the days, split by agent, the most cost first", () => {
		const spend = summarize([
			answer("builder", 0.5),
			answer("improver", 2),
			answer("improver", 1, 3),
			answer("field-writer", 0.25, 6),
			// Outside 7 days, inside 30.
			answer("explainer", 4, 10),
		]);
		expect(days(spend, 7)).toEqual({
			total: 3.75,
			answers: 4,
			unknown: 0,
			agents: [
				{ agent: "improver", answers: 2, costUsd: 3 },
				{ agent: "builder", answers: 1, costUsd: 0.5 },
				{ agent: "field-writer", answers: 1, costUsd: 0.25 },
			],
		});
		expect(days(spend, 30)?.total).toBe(7.75);
		expect(days(spend, 30)?.agents[0]).toEqual({
			agent: "explainer",
			answers: 1,
			costUsd: 4,
		});
	});

	test("an answer with no known cost counts as an answer, not in the total", () => {
		const spend = summarize([
			answer("explainer", null),
			answer("explainer", 1),
		]);
		expect(days(spend, 7)).toEqual({
			total: 1,
			answers: 2,
			unknown: 1,
			agents: [{ agent: "explainer", answers: 2, costUsd: 1 }],
		});
	});

	test("help is not in the spend of the runs", () => {
		const spend = summarize([answer("builder", 5)], [cost(2)]);
		const week = spend.ranges.find((range) => range.nights === 7);
		expect(week?.total).toBe(2);
		expect(week?.help.total).toBe(5);
	});

	test("this month holds the answers since the first day of the month", () => {
		// NOW is 21 October: 20 days ago is 1 October, 21 days ago is 30 September.
		const spend = summarize([
			answer("builder", 1),
			answer("builder", 2, 20),
			answer("builder", 8, 21),
		]);
		expect(spend.helpThisMonth).toBe(3);
	});

	test("the month starts on the reader's clock", () => {
		// 1 November 00:30 in Amsterdam is still 31 October in UTC.
		const now = parseInstant("2026-10-31T23:30:00Z");
		const help = [{ ...answer("builder", 2), at: now - HOUR }];
		const read = (timeZone: string) =>
			summarizeSpend([], { now, timeZone, help }).helpThisMonth;
		expect(read("UTC")).toBe(2);
		expect(read("Europe/Amsterdam")).toBe(0);
	});
});
