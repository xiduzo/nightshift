import type { RunSummary } from "../read";
import { isTestRun } from "../run-status";
import { dayStart, lastDays } from "./clock";
import { hasEnded, spreadOf } from "./stats";
import {
	type CostSteadiness,
	NIGHT_RANGES,
	type NightRange,
	type SavingKind,
	type SpaceSpend,
	type SpendDays,
	type SpendFlow,
	type SpendSaving,
	type SpendStep,
	type Spread,
} from "./types";

/**
 * The Spend page (docs/research/dashboards-2026-11.md, Q9): what the runs
 * of a Space cost, how steady the cost of each flow is, and where a
 * change saves money. All of it is read from the runs. Nobody sets a
 * threshold: a flow's usual run is the median of its own finished runs.
 *
 * A run counts under its own flow. What a Subflow cost is in the run that
 * called it, so the flows add up to the total. A test run counts in the
 * spend only: not in a usual run, and not in a way to save.
 */

/** Fewer finished runs with a known cost: the flow has no steadiness yet. */
const STEADINESS_MIN_RUNS = 3;
/** Steady: the middle half of the runs stay this share around a usual run. */
const STEADY_SHARE = 0.2;
/** Steady: no run costs over this many times a usual run. */
const STEADY_MAX = 2;
/** Unsteady: a quarter of the runs cost over this many times a usual run. */
const UNSTEADY_Q3 = 2;
/** Unsteady: one run costs over this many times a usual run. */
const UNSTEADY_MAX = 4;
/** A run is costly when it cost over this many times a usual run. */
const COSTLY_FACTOR = 2;
/** Fewer finished runs with a known cost: no run is costly yet. */
const COSTLY_MIN_RUNS = 5;
/** Fewer runs with nothing to do: bad luck, not a way to save. */
const NOTHING_MIN_RUNS = 2;
/** The steps a flow's row carries. */
const STEP_ROWS = 8;

type Placed = { run: RunSummary; day: number };

/**
 * How steady the runs in `usual` are against a usual one: what they cost,
 * or how long they work. Null with too few of them.
 */
export function steadinessOf(usual: Spread | null): CostSteadiness | null {
	if (!usual || usual.count < STEADINESS_MIN_RUNS || usual.median <= 0) {
		return null;
	}
	const one = usual.median;
	if (usual.q3 > one * UNSTEADY_Q3 || usual.max > one * UNSTEADY_MAX) {
		return "unsteady";
	}
	return usual.q1 >= one * (1 - STEADY_SHARE) &&
		usual.q3 <= one * (1 + STEADY_SHARE) &&
		usual.max <= one * STEADY_MAX
		? "steady"
		: "varies";
}

/** What each node of a run cost and how often its work landed, by `<via>/<nodeId>`. */
function nodeCosts(
	run: RunSummary,
): Map<string, { nodeId: string; via?: string; cost: number; landed: number }> {
	const nodes = new Map<
		string,
		{ nodeId: string; via?: string; cost: number; landed: number }
	>();
	for (const row of run.metrics?.ladder ?? []) {
		const key = `${row.via ?? ""}/${row.nodeId}`;
		const node = nodes.get(key) ?? {
			nodeId: row.nodeId,
			...(row.via !== undefined ? { via: row.via } : {}),
			cost: 0,
			landed: 0,
		};
		node.cost += row.costUsd;
		node.landed += row.landed;
		nodes.set(key, node);
	}
	return nodes;
}

type StepTally = SpendStep & { total: number; landed: number };

/** What each step cost over `runs`, per run: the same shape as a flow's row carries. */
function stepTallies(runs: readonly RunSummary[]): Map<string, StepTally> {
	const steps = new Map<string, StepTally>();
	for (const run of runs) {
		for (const [key, node] of nodeCosts(run)) {
			const step = steps.get(key) ?? {
				key,
				nodeId: node.nodeId,
				...(node.via !== undefined ? { via: node.via } : {}),
				perRun: 0,
				most: 0,
				timesPerRun: 0,
				total: 0,
				landed: 0,
			};
			step.total += node.cost;
			step.landed += node.landed;
			step.most = Math.max(step.most, node.cost);
			steps.set(key, step);
		}
	}
	for (const step of steps.values()) {
		step.perRun = step.total / runs.length;
		step.timesPerRun = step.landed / runs.length;
	}
	return steps;
}

/** The steps that cost money, the most per run first. */
function stepRows(runs: readonly RunSummary[]): SpendStep[] {
	return [...stepTallies(runs).values()]
		.filter((step) => step.most > 0)
		.sort((a, b) => b.perRun - a.perRun || a.key.localeCompare(b.key))
		.slice(0, STEP_ROWS)
		.map(({ total: _total, landed: _landed, ...step }) => step);
}

/**
 * The step of the costly runs that cost the most above what it costs in
 * the other runs. Undefined when no step explains it.
 */
function costlyStep(
	costly: readonly RunSummary[],
	others: readonly RunSummary[],
): SpendSaving["step"] {
	const usual = stepTallies(others);
	let top: { step: StepTally; extra: number } | undefined;
	for (const step of stepTallies(costly).values()) {
		const extra = step.perRun - (usual.get(step.key)?.perRun ?? 0);
		if (extra > 0 && (top === undefined || extra > top.extra)) {
			top = { step, extra };
		}
	}
	if (!top) return undefined;
	const { nodeId, via } = top.step;
	return { nodeId, ...(via !== undefined ? { via } : {}) };
}

/** One flow over the days, its ways to save, and what each run of them saves. */
function flowSpend(
	projectId: string,
	flow: string,
	placed: readonly Placed[],
): { row: SpendFlow; savings: SpendSaving[]; saved: Map<string, number> } {
	const all = placed.map(({ run }) => run);
	const own = all.filter((run) => !isTestRun(run));
	const finished = own.filter((run) => run.status === "finished");
	const known = finished.filter(
		(run) => run.costCalls > 0 && run.costMissing === 0,
	);
	const usual = spreadOf(known.map((run) => run.costUsd));

	const unfinished = own.filter(
		(run) => hasEnded(run) && run.status !== "finished" && run.costUsd > 0,
	);
	const idle = finished.filter(
		(run) => run.result === "nothing-to-do" && run.costUsd > 0,
	);
	const nothing = idle.length >= NOTHING_MIN_RUNS ? idle : [];
	const one = usual?.median ?? 0;
	const costly =
		usual && usual.count >= COSTLY_MIN_RUNS && one > 0
			? known.filter(
					(run) => !nothing.includes(run) && run.costUsd > one * COSTLY_FACTOR,
				)
			: [];

	const saved = new Map<string, number>();
	const savings: SpendSaving[] = [];
	const add = (
		kind: SavingKind,
		runs: readonly RunSummary[],
		saves: (run: RunSummary) => number,
		step?: SpendSaving["step"],
	) => {
		const newest = runs.reduce<RunSummary | undefined>(
			(last, run) =>
				last === undefined || run.createdAt > last.createdAt ? run : last,
			undefined,
		);
		if (!newest) return;
		for (const run of runs) saved.set(run.id, saves(run));
		savings.push({
			key: `${projectId}/${flow}/${kind}`,
			kind,
			projectId,
			flow,
			saves: runs.reduce((sum, run) => sum + saves(run), 0),
			runs: runs.length,
			of: own.length,
			runId: newest.id,
			...(step ? { step } : {}),
		});
	};
	add("unfinished", unfinished, (run) => run.costUsd);
	add("nothing", nothing, (run) => run.costUsd);
	add(
		"costly",
		costly,
		(run) => run.costUsd - one,
		costlyStep(
			costly,
			known.filter((run) => !costly.includes(run)),
		),
	);

	return {
		row: {
			key: `${projectId}/${flow}`,
			projectId,
			flow,
			runs: all.length,
			spent: all.reduce((sum, run) => sum + run.costUsd, 0),
			usual,
			steadiness: steadinessOf(usual),
			saves: savings.reduce((sum, saving) => sum + saving.saves, 0),
			steps: stepRows(known),
		},
		savings,
		saved,
	};
}

/** The Spend page over the last `range` days. */
function spendDays(
	range: NightRange,
	runs: readonly Placed[],
	now: number,
	timeZone: string,
): SpendDays {
	const both = lastDays(range * 2, now, timeZone);
	const days = both.slice(range);
	const first = days[0] ?? 0;
	const earliest = both[0] ?? 0;
	const inRange = runs.filter(({ day }) => day >= first);
	const total = (of: readonly Placed[]) =>
		of.reduce((sum, { run }) => sum + run.costUsd, 0);

	const byFlow = new Map<string, Placed[]>();
	const quick: Placed[] = [];
	for (const placed of inRange) {
		const { flowName, projectId } = placed.run;
		if (flowName === null) {
			quick.push(placed);
			continue;
		}
		const key = `${projectId}\n${flowName}`;
		byFlow.set(key, [...(byFlow.get(key) ?? []), placed]);
	}
	const flows = [...byFlow.values()].flatMap((ofFlow) => {
		const run = ofFlow[0]?.run;
		return run?.flowName
			? [flowSpend(run.projectId, run.flowName, ofFlow)]
			: [];
	});
	const saved = new Map(flows.flatMap((flow) => [...flow.saved]));
	const savings = flows
		.flatMap((flow) => flow.savings)
		.sort((a, b) => b.saves - a.saves || a.key.localeCompare(b.key));

	return {
		nights: range,
		total: total(inRange),
		before: total(runs.filter(({ day }) => day >= earliest && day < first)),
		runs: inRange.length,
		unknown: inRange.filter(({ run }) => run.costMissing > 0).length,
		perNight: days.map((night) => {
			const ofDay = inRange.filter(({ day }) => day === night);
			return {
				night,
				costUsd: total(ofDay),
				saves: ofDay.reduce(
					(sum, { run }) => sum + (saved.get(run.id) ?? 0),
					0,
				),
			};
		}),
		flows: flows
			.map((flow) => flow.row)
			.sort((a, b) => b.spent - a.spent || a.key.localeCompare(b.key)),
		quick: { runs: quick.length, spent: total(quick) },
		savings,
		saves: savings.reduce((sum, saving) => sum + saving.saves, 0),
	};
}

/** The Spend page of `runs`, for each day range. */
export function summarizeSpend(
	runs: readonly RunSummary[],
	options: { now: number; timeZone: string },
): SpaceSpend {
	const placed = runs.map((run) => ({
		run,
		day: dayStart(run.createdAt, options.timeZone),
	}));
	return {
		at: options.now,
		ranges: NIGHT_RANGES.map((range) =>
			spendDays(range, placed, options.now, options.timeZone),
		),
	};
}
