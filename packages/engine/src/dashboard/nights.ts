import type { RunSummary } from "../read";
import { isTestRun } from "../run-status";
import { dayStart, lastDays } from "./clock";
import { neededRange, neededReasons } from "./needed";
import {
	countStatuses,
	hasEnded,
	spreadOf,
	toDashboardRun,
	toLatestReport,
	topRows,
	usedTokens,
} from "./stats";
import {
	type AskedGate,
	type FailedRun,
	type FailingFlow,
	type FlowReport,
	type GateState,
	type GatesGroup,
	type GatesRange,
	type NightCounts,
	type NightRange,
	type NightsRange,
	type NightTotals,
	OVERVIEW_ROWS,
	type PeriodTotals,
	type RunsRange,
	type SpendGroup,
	type SpendRange,
	type TopRows,
} from "./types";

/** Spend groups beyond this many fold into one. The theme has five chart colors. */
const MAX_SPEND_GROUPS = 4;

/** The order the Gates chart stacks the states in. */
const GATE_STATES: GateState[] = ["answered", "unanswered", "waiting"];

/** A run with the start of its day and its group, worked out once. */
export type PlacedRun = { run: RunSummary; day: number; group: string };

/**
 * The runs without the test runs (`isTestRun`): every number but spend
 * counts these.
 */
export function notTests(runs: readonly PlacedRun[]): PlacedRun[] {
	return runs.filter(({ run }) => !isTestRun(run));
}

/** A Gate a run asked, with the start of the day it opened in. */
type PlacedGate = AskedGate & { day: number };

/**
 * Every Gate the runs asked. A Gate is answered when a person chose its
 * option. One whose deadline chose, or that closed with no answer (its
 * run stopped or failed while it waited), was not answered. An open one
 * waits while its run waits. The caller leaves the test runs out.
 */
export function askedGates(
	runs: readonly PlacedRun[],
	now: number,
	timeZone: string,
): PlacedGate[] {
	return runs.flatMap(({ run, group }) =>
		run.gates.map((gate, index) => {
			const state: GateState =
				gate.answeredBy === "person"
					? "answered"
					: gate.closedAt === null && run.status === "waiting"
						? "waiting"
						: "unanswered";
			return {
				key: `${run.id}-${index}`,
				runId: run.id,
				runTitle: run.title,
				group,
				openedAt: gate.openedAt,
				day: dayStart(gate.openedAt, timeZone),
				state,
				wait:
					gate.closedAt !== null
						? gate.closedAt - gate.openedAt
						: state === "waiting"
							? Math.max(now - gate.openedAt, 0)
							: null,
			};
		}),
	);
}

/**
 * Counts per day of `items`, by `keyOf`, with a zero for each of `keys`.
 * The wire still names a day `night`.
 */
function perDay<T extends { day: number }>(
	days: readonly number[],
	items: readonly T[],
	keys: readonly string[],
	countOf: (item: T) => { key: string; value: number },
): NightCounts[] {
	return days.map((day) => {
		const counts: Record<string, number> = {};
		for (const key of keys) counts[key] = 0;
		for (const item of items) {
			if (item.day !== day) continue;
			const { key, value } = countOf(item);
			counts[key] = (counts[key] ?? 0) + value;
		}
		return { night: day, counts };
	});
}

/** Spend per day, stacked by group, the dearest runs and the totals. */
function spendOf(days: readonly number[], inRange: PlacedRun[]): SpendRange {
	const byLabel = new Map<
		string,
		{
			runs: number;
			total: number;
			unfinished: number;
			tokens: number;
			unfinishedTokens: number;
		}
	>();
	for (const { run, group } of inRange) {
		const totals = byLabel.get(group) ?? {
			runs: 0,
			total: 0,
			unfinished: 0,
			tokens: 0,
			unfinishedTokens: 0,
		};
		const used = usedTokens(run);
		totals.runs += 1;
		totals.total += run.costUsd;
		totals.tokens += used;
		if (hasEnded(run) && run.status !== "finished") {
			totals.unfinished += run.costUsd;
			totals.unfinishedTokens += used;
		}
		byLabel.set(group, totals);
	}
	const ranked = [...byLabel.entries()].sort((a, b) => b[1].total - a[1].total);
	const top = ranked.slice(0, MAX_SPEND_GROUPS);
	const rest = ranked.slice(MAX_SPEND_GROUPS);
	const groups: SpendGroup[] = top.map(([label, totals], index) => ({
		key: `g${index}`,
		label,
		...totals,
	}));
	if (rest.length > 0) {
		groups.push({
			key: "other",
			label: `${rest.length} more`,
			runs: rest.reduce((sum, [, totals]) => sum + totals.runs, 0),
			total: rest.reduce((sum, [, totals]) => sum + totals.total, 0),
			unfinished: rest.reduce((sum, [, totals]) => sum + totals.unfinished, 0),
			tokens: rest.reduce((sum, [, totals]) => sum + totals.tokens, 0),
			unfinishedTokens: rest.reduce(
				(sum, [, totals]) => sum + totals.unfinishedTokens,
				0,
			),
		});
	}
	const keyOf = new Map(
		top.map(([label], index) => [label, `g${index}`] as const),
	);
	return {
		total: inRange.reduce((sum, { run }) => sum + run.costUsd, 0),
		tokens: inRange.reduce((sum, { run }) => sum + usedTokens(run), 0),
		runs: inRange.length,
		nightsWithRuns: new Set(inRange.map(({ day }) => day)).size,
		unknown: inRange.filter(({ run }) => run.costMissing > 0).length,
		groups,
		perNight: perDay(
			days,
			inRange,
			groups.map((group) => group.key),
			({ run, group }) => ({
				key: keyOf.get(group) ?? "other",
				value: run.costUsd,
			}),
		),
		tokensPerNight: perDay(
			days,
			inRange,
			groups.map((group) => group.key),
			({ run, group }) => ({
				key: keyOf.get(group) ?? "other",
				value: usedTokens(run),
			}),
		),
		priciest: inRange
			.filter(({ run }) => run.costUsd > 0)
			.sort((a, b) => b.run.costUsd - a.run.costUsd)
			.slice(0, OVERVIEW_ROWS)
			.map(({ run, group }) => toDashboardRun(run, group)),
	};
}

/** How runs went: per day by status, per group, and the failures. */
function runsOf(days: readonly number[], inRange: PlacedRun[]): RunsRange {
	const ended = inRange.filter(
		({ run }) => run.status === "finished" || run.status === "failed",
	);
	const statuses = countStatuses(inRange.map(({ run }) => run));
	const byGroup = new Map<string, RunSummary[]>();
	for (const { run, group } of inRange) {
		byGroup.set(group, [...(byGroup.get(group) ?? []), run]);
	}
	const groups = [...byGroup.entries()]
		.map(([label, ofGroup]) => ({
			label,
			runs: ofGroup.length,
			finished: ofGroup.filter((run) => run.status === "finished").length,
			failed: ofGroup.filter((run) => run.status === "failed").length,
		}))
		.sort((a, b) => b.runs - a.runs);
	const failed = inRange
		.filter(({ run }) => run.status === "failed")
		.sort((a, b) => b.run.createdAt - a.run.createdAt)
		.map(({ run, group }): FailedRun => {
			const later = (byGroup.get(group) ?? [])
				.filter((other) => other.createdAt > run.createdAt)
				.sort((a, b) => b.createdAt - a.createdAt);
			const last = later[0];
			return {
				...toDashboardRun(run, group),
				after: {
					runs: later.length,
					finished: later.filter((other) => other.status === "finished").length,
					last: last
						? { status: last.status, createdAt: last.createdAt }
						: null,
				},
			};
		});
	return {
		runs: inRange.length,
		ended: ended.length,
		finished: ended.filter(({ run }) => run.status === "finished").length,
		nightsWithRuns: new Set(inRange.map(({ day }) => day)).size,
		statuses,
		perNight: perDay(
			days,
			inRange,
			statuses.map(({ status }) => status),
			({ run }) => ({ key: run.status, value: 1 }),
		),
		groups: topRows(groups),
		failed: topRows(failed),
		...failingOf(inRange),
	};
}

/** The flows with failed runs in the range, one row per flow. */
function failingOf(
	inRange: PlacedRun[],
): Pick<RunsRange, "failing" | "stillFailing"> {
	const keyOf = (run: RunSummary) =>
		`${run.projectId}/${run.flowName ?? run.title}`;
	const flows = new Map<string, FailingFlow>();
	for (const { run, group } of inRange) {
		if (run.status !== "failed") continue;
		const key = keyOf(run);
		const flow = flows.get(key);
		if (flow && flow.lastAt >= run.createdAt) {
			flow.failed += 1;
			continue;
		}
		flows.set(key, {
			key,
			group,
			title: run.flowName ?? run.title,
			runId: run.id,
			lastAt: run.createdAt,
			reason: run.reason,
			failed: (flow?.failed ?? 0) + 1,
			fixedAt: null,
		});
	}
	for (const { run } of inRange) {
		const flow = flows.get(keyOf(run));
		if (!flow || run.status !== "finished" || run.createdAt <= flow.lastAt) {
			continue;
		}
		flow.fixedAt = Math.min(flow.fixedAt ?? run.createdAt, run.createdAt);
	}
	const failing = [...flows.values()].sort(
		(a, b) =>
			Number(a.fixedAt !== null) - Number(b.fixedAt !== null) ||
			b.lastAt - a.lastAt,
	);
	return {
		failing: topRows(failing),
		stillFailing: failing.filter((flow) => flow.fixedAt === null).length,
	};
}

/**
 * The newest report of each flow whose runs in the range wrote one: one
 * row per flow, the newest end first. The runs are the runs of their own
 * that started in the range: a called flow's report counts in no row.
 */
function reportsOf(inRange: readonly PlacedRun[]): TopRows<FlowReport> {
	const flows = new Map<string, FlowReport>();
	for (const { run, group } of inRange) {
		const report = toLatestReport(run);
		if (report === null) continue;
		const key = `${run.projectId}/${run.flowName ?? run.title}`;
		const newest = flows.get(key);
		if (newest && newest.endedAt >= report.endedAt) continue;
		flows.set(key, {
			...report,
			key,
			group,
			title: run.flowName ?? run.title,
		});
	}
	return topRows([...flows.values()].sort((a, b) => b.endedAt - a.endedAt));
}

function waitsOf(gates: readonly AskedGate[]): number[] {
	return gates.flatMap((gate) => (gate.wait === null ? [] : [gate.wait]));
}

/** The Gates asked: per day by state, per group, and the latest. */
function gatesOf(days: readonly number[], asked: PlacedGate[]): GatesRange {
	const answered = asked.filter((gate) => gate.state === "answered");
	const byLabel = new Map<string, PlacedGate[]>();
	for (const gate of asked) {
		byLabel.set(gate.group, [...(byLabel.get(gate.group) ?? []), gate]);
	}
	const groups: GatesGroup[] = [...byLabel.entries()]
		.map(([label, ofGroup]) => {
			const answeredOfGroup = ofGroup.filter(
				(gate) => gate.state === "answered",
			);
			return {
				label,
				asked: ofGroup.length,
				answered: answeredOfGroup.length,
				unanswered: ofGroup.filter((gate) => gate.state === "unanswered")
					.length,
				waiting: ofGroup.filter((gate) => gate.state === "waiting").length,
				runs: new Set(ofGroup.map((gate) => gate.runId)).size,
				lastAskedAt: Math.max(...ofGroup.map((gate) => gate.openedAt)),
				typical: spreadOf(waitsOf(answeredOfGroup))?.median ?? null,
				longest: spreadOf(waitsOf(ofGroup))?.max ?? null,
			};
		})
		.sort((a, b) => b.asked - a.asked);
	const states = GATE_STATES.filter((state) =>
		asked.some((gate) => gate.state === state),
	);
	return {
		asked: asked.length,
		runsAsking: new Set(asked.map((gate) => gate.runId)).size,
		answered: answered.length,
		unanswered: asked.filter((gate) => gate.state === "unanswered").length,
		answerTime: spreadOf(waitsOf(answered)),
		states,
		perNight: perDay(days, asked, states, (gate) => ({
			key: gate.state,
			value: 1,
		})),
		groups: topRows(groups),
		latest: asked
			.slice(-OVERVIEW_ROWS)
			.reverse()
			.map(({ day: _day, ...gate }) => gate),
	};
}

/**
 * The headline numbers of `days`, per day and in all. A test run counts
 * only in the spend. `gates` are of the other runs only.
 */
function totalsOf(
	days: readonly number[],
	runs: readonly PlacedRun[],
	gates: readonly PlacedGate[],
): PeriodTotals {
	const perNight = days.map((day): NightTotals => {
		const ofDay = runs.filter((placed) => placed.day === day);
		const counted = notTests(ofDay);
		const finished = counted.filter(({ run }) => run.status === "finished");
		const failed = counted.filter(({ run }) => run.status === "failed");
		return {
			night: day,
			runs: counted.length,
			ended: finished.length + failed.length,
			finished: finished.length,
			costUsd: ofDay.reduce((sum, { run }) => sum + run.costUsd, 0),
			tokens: ofDay.reduce((sum, { run }) => sum + usedTokens(run), 0),
			gates: gates.filter((gate) => gate.day === day).length,
			neededYou: counted.filter(({ run }) => neededReasons(run).length > 0)
				.length,
		};
	});
	const sum = (key: keyof Omit<NightTotals, "night">) =>
		perNight.reduce((total, day) => total + (day[key] ?? 0), 0);
	return {
		runs: sum("runs"),
		ended: sum("ended"),
		finished: sum("finished"),
		costUsd: sum("costUsd"),
		tokens: sum("tokens"),
		gates: sum("gates"),
		neededYou: sum("neededYou"),
		perNight,
	};
}

/**
 * Spend, runs, Gates, Needed you and the latest reports over the last
 * `range` days, today included, and the headline numbers of the `range`
 * days before. Flow health is the caller's: it needs the flows. A test
 * run counts only in the spend. `gates` are of the other runs only.
 */
export function nightsRange(
	range: NightRange,
	runs: readonly PlacedRun[],
	gates: readonly PlacedGate[],
	now: number,
	timeZone: string,
): Omit<NightsRange, "flows"> {
	const both = lastDays(range * 2, now, timeZone);
	const days = both.slice(range);
	const first = days[0] ?? 0;
	const inRange = runs.filter(({ day }) => day >= first);
	const counted = notTests(inRange);
	const asked = gates
		.filter((gate) => gate.day >= first)
		.sort((a, b) => a.openedAt - b.openedAt);
	return {
		nights: range,
		spend: spendOf(days, inRange),
		runs: runsOf(days, counted),
		gates: gatesOf(days, asked),
		needed: neededRange(
			days,
			counted.map(({ run, day, group }) => ({
				runId: run.id,
				title: run.title,
				createdAt: run.createdAt,
				day,
				group,
				reasons: neededReasons(run),
			})),
		),
		reports: reportsOf(counted),
		totals: totalsOf(days, inRange, asked),
		before: totalsOf(both.slice(0, range), runs, gates),
	};
}
