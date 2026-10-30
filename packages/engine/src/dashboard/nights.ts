import type { RunSummary } from "../read";
import { lastNights, nightOf } from "./clock";
import {
	countStatuses,
	hasEnded,
	spreadOf,
	toDashboardRun,
	topRows,
} from "./stats";
import {
	type AskedGate,
	type FailedRun,
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
} from "./types";

/** Spend groups beyond this many fold into one. The theme has five chart colors. */
const MAX_SPEND_GROUPS = 4;

/** The order the Gates chart stacks the states in. */
const GATE_STATES: GateState[] = ["answered", "unanswered", "waiting"];

/** A run with its night and its group, worked out once. */
export type PlacedRun = { run: RunSummary; night: number; group: string };

/** A Gate a run asked, with the night it opened in. */
type PlacedGate = AskedGate & { night: number };

/**
 * Every Gate the runs asked. A Gate that closed when its run ended, without
 * the run finishing, was not answered: the run stopped or failed while it
 * waited. So was one left open by a run that no longer waits.
 */
export function askedGates(
	runs: readonly PlacedRun[],
	now: number,
	timeZone: string,
): PlacedGate[] {
	return runs.flatMap(({ run, group }) =>
		run.gates.map((gate, index) => {
			const state: GateState =
				gate.closedAt === null
					? run.status === "waiting"
						? "waiting"
						: "unanswered"
					: gate.closedAt === run.endedAt && run.status !== "finished"
						? "unanswered"
						: "answered";
			return {
				key: `${run.id}-${index}`,
				runId: run.id,
				runTitle: run.title,
				group,
				openedAt: gate.openedAt,
				night: nightOf(gate.openedAt, timeZone),
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

/** Counts per night of `items`, by `keyOf`, with a zero for each of `keys`. */
function perNight<T extends { night: number }>(
	nights: readonly number[],
	items: readonly T[],
	keys: readonly string[],
	countOf: (item: T) => { key: string; value: number },
): NightCounts[] {
	return nights.map((night) => {
		const counts: Record<string, number> = {};
		for (const key of keys) counts[key] = 0;
		for (const item of items) {
			if (item.night !== night) continue;
			const { key, value } = countOf(item);
			counts[key] = (counts[key] ?? 0) + value;
		}
		return { night, counts };
	});
}

/** Spend per night, stacked by group, the dearest runs and the totals. */
function spendOf(nights: readonly number[], inRange: PlacedRun[]): SpendRange {
	const byLabel = new Map<
		string,
		{ runs: number; total: number; unfinished: number }
	>();
	for (const { run, group } of inRange) {
		const totals = byLabel.get(group) ?? { runs: 0, total: 0, unfinished: 0 };
		totals.runs += 1;
		totals.total += run.costUsd;
		if (hasEnded(run) && run.status !== "finished") {
			totals.unfinished += run.costUsd;
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
		});
	}
	const keyOf = new Map(
		top.map(([label], index) => [label, `g${index}`] as const),
	);
	return {
		total: inRange.reduce((sum, { run }) => sum + run.costUsd, 0),
		runs: inRange.length,
		nightsWithRuns: new Set(inRange.map(({ night }) => night)).size,
		unknown: inRange.filter(({ run }) => run.costMissing > 0).length,
		groups,
		perNight: perNight(
			nights,
			inRange,
			groups.map((group) => group.key),
			({ run, group }) => ({
				key: keyOf.get(group) ?? "other",
				value: run.costUsd,
			}),
		),
		priciest: inRange
			.filter(({ run }) => run.costUsd > 0)
			.sort((a, b) => b.run.costUsd - a.run.costUsd)
			.slice(0, OVERVIEW_ROWS)
			.map(({ run, group }) => toDashboardRun(run, group)),
	};
}

/** How runs went: per night by status, per group, and the failures. */
function runsOf(nights: readonly number[], inRange: PlacedRun[]): RunsRange {
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
		nightsWithRuns: new Set(inRange.map(({ night }) => night)).size,
		statuses,
		perNight: perNight(
			nights,
			inRange,
			statuses.map(({ status }) => status),
			({ run }) => ({ key: run.status, value: 1 }),
		),
		groups: topRows(groups),
		failed: topRows(failed),
	};
}

function waitsOf(gates: readonly AskedGate[]): number[] {
	return gates.flatMap((gate) => (gate.wait === null ? [] : [gate.wait]));
}

/** The Gates asked: per night by state, per group, and the latest. */
function gatesOf(nights: readonly number[], asked: PlacedGate[]): GatesRange {
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
		perNight: perNight(nights, asked, states, (gate) => ({
			key: gate.state,
			value: 1,
		})),
		groups: topRows(groups),
		latest: asked
			.slice(-OVERVIEW_ROWS)
			.reverse()
			.map(({ night: _night, ...gate }) => gate),
	};
}

/** The headline numbers of `nights`, per night and in all. */
function totalsOf(
	nights: readonly number[],
	runs: readonly PlacedRun[],
	gates: readonly PlacedGate[],
): PeriodTotals {
	const perNight = nights.map((night): NightTotals => {
		const ofNight = runs.filter((placed) => placed.night === night);
		const finished = ofNight.filter(({ run }) => run.status === "finished");
		const failed = ofNight.filter(({ run }) => run.status === "failed");
		return {
			night,
			runs: ofNight.length,
			ended: finished.length + failed.length,
			finished: finished.length,
			costUsd: ofNight.reduce((sum, { run }) => sum + run.costUsd, 0),
			gates: gates.filter((gate) => gate.night === night).length,
		};
	});
	const sum = (key: keyof Omit<NightTotals, "night">) =>
		perNight.reduce((total, night) => total + night[key], 0);
	return {
		runs: sum("runs"),
		ended: sum("ended"),
		finished: sum("finished"),
		costUsd: sum("costUsd"),
		gates: sum("gates"),
		perNight,
	};
}

/**
 * Spend, runs and Gates over the last `range` nights, and the headline
 * numbers of the `range` nights before. Flow health is the caller's: it
 * needs the flows.
 */
export function nightsRange(
	range: NightRange,
	runs: readonly PlacedRun[],
	gates: readonly PlacedGate[],
	now: number,
	timeZone: string,
): Omit<NightsRange, "flows"> {
	const both = lastNights(range * 2, now, timeZone);
	const nights = both.slice(range);
	const first = nights[0] ?? 0;
	const inRange = runs.filter(({ night }) => night >= first);
	const asked = gates
		.filter((gate) => gate.night >= first)
		.sort((a, b) => a.openedAt - b.openedAt);
	return {
		nights: range,
		spend: spendOf(nights, inRange),
		runs: runsOf(nights, inRange),
		gates: gatesOf(nights, asked),
		totals: totalsOf(nights, inRange, asked),
		before: totalsOf(both.slice(0, range), runs, gates),
	};
}
