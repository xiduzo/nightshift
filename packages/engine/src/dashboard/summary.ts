import type { RunSummary } from "../read";
import { DAY_MS, HOUR_MS, lastHours, nightOf } from "./clock";
import { FLOW_HEALTH_NIGHTS, flowHealthRows } from "./flow-health";
import { askedGates, nightsRange, type PlacedRun } from "./nights";
import {
	isOpen,
	sumKnownCost,
	toDashboardRun,
	topRows,
	usedTokens,
} from "./stats";
import {
	type ActivityRange,
	type AtWorkGroup,
	type CardHour,
	type DashboardCards,
	type DashboardSummary,
	type DayCounts,
	HOUR_RANGES,
	type HourRange,
	NIGHT_RANGES,
	type NightOutput,
	OVERVIEW_ROWS,
	type UpcomingRun,
} from "./types";

/** The hours of the stat cards' small charts. */
const CARD_HOURS = 24;

/**
 * What the dashboard covers: one project, whose runs group by flow, or
 * every project, whose runs group by project.
 */
export type DashboardScope =
	| {
			kind: "project";
			/** The project's flows, for Flow health. */
			flows: readonly string[];
	  }
	| {
			kind: "all";
			/** Each project's name by its id. A run of a project not in it is of a removed one. */
			projectNames: ReadonlyMap<string, string>;
	  };

export type DashboardOptions = {
	now: number;
	/** The reader's time zone (IANA): where a night's noon falls. */
	timeZone: string;
	scope: DashboardScope;
};

/** The group a run counts in: its flow in a project, its project over all of them. */
function groupOf(scope: DashboardScope): (run: RunSummary) => string {
	return scope.kind === "project"
		? (run) => run.flowName ?? "Quick runs"
		: (run) => scope.projectNames.get(run.projectId) ?? "Removed";
}

/**
 * When a run was at work. An open run works until now. A run that never
 * ended (interrupted) counts for its start only.
 */
function spanOf(run: RunSummary, now: number) {
	return {
		from: run.createdAt,
		to: run.endedAt ?? (isOpen(run) ? now : run.createdAt),
	};
}

type Span = { from: number; to: number };

/**
 * When a run slept or a Gate of it waited for a person, in order. One that
 * is still open lasts until now while the run sleeps or waits.
 */
function idleSpans(run: RunSummary, now: number): Span[] {
	const gates = run.gates.map((gate) => ({
		from: gate.openedAt,
		to: gate.closedAt ?? (run.status === "waiting" ? now : gate.openedAt),
	}));
	const sleeps = (run.sleeps ?? []).map((sleep) => ({
		from: sleep.from,
		to: sleep.to ?? (run.status === "sleeping" ? now : sleep.from),
	}));
	return [...gates, ...sleeps].sort((a, b) => a.from - b.from);
}

/** When a run was at work: its span without the time it slept or waited for a person. */
function workSpans(run: RunSummary, now: number): Span[] {
	const span = spanOf(run, now);
	const work: Span[] = [];
	let at = span.from;
	for (const idle of idleSpans(run, now)) {
		if (idle.to <= at || idle.from >= span.to) continue;
		if (idle.from > at) work.push({ from: at, to: idle.from });
		at = Math.max(at, idle.to);
	}
	if (at < span.to) work.push({ from: at, to: span.to });
	// Like a run that never ended: it counts for its start only.
	return work.length > 0 ? work : [{ from: span.from, to: span.from }];
}

/** How long the spans last after `since`. */
function lengthSince(spans: readonly Span[], since: number): number {
	return spans.reduce(
		(sum, span) => sum + Math.max(span.to - Math.max(span.from, since), 0),
		0,
	);
}

/** How many runs, each with its spans, were at work at the moment `at`. */
function atMoment(at: number, runs: readonly Span[][]): number {
	return runs.filter((spans) =>
		spans.some((span) => span.from <= at && span.to >= at),
	).length;
}

/** How many runs started, how they ended and what they cost. */
function dayCountsOf(runs: readonly RunSummary[]): DayCounts {
	return {
		runs: runs.length,
		finished: runs.filter((run) => run.status === "finished").length,
		failed: runs.filter((run) => run.status === "failed").length,
		cost: sumKnownCost(runs),
		tokens: runs.reduce((sum, run) => sum + usedTokens(run), 0),
	};
}

/** How many runs, each with its spans, touch each hour. */
function perHour(hours: readonly number[], runs: readonly Span[][]): number[] {
	return hours.map(
		(hour) =>
			runs.filter((spans) =>
				spans.some((span) => span.from < hour + HOUR_MS && span.to >= hour),
			).length,
	);
}

/**
 * The numbers on top: what runs now, what slept, and the last day, with
 * the day before and this time yesterday to compare with. The small
 * charts count per hour. Runs count in the hour they started, so the
 * bars add up to the card's number. The day reaches back into the hour
 * before the first bar: those runs count in the first hour.
 */
function cardsOf(
	runs: readonly RunSummary[],
	now: number,
	timeZone: string,
): DashboardCards {
	const sleeping = runs.filter((run) => run.status === "sleeping");
	const lastDay = runs.filter((run) => run.createdAt >= now - DAY_MS);
	const dayBefore = runs.filter(
		(run) => run.createdAt >= now - 2 * DAY_MS && run.createdAt < now - DAY_MS,
	);
	const hours = lastHours(CARD_HOURS, now, timeZone);
	const first = hours[0] ?? now;
	const runSpans = runs.map((run) => workSpans(run, now));
	const gateSpans = runs.flatMap((run) =>
		run.gates.map((gate) => [
			{
				from: gate.openedAt,
				to: gate.closedAt ?? (run.status === "waiting" ? now : gate.openedAt),
			},
		]),
	);
	const active = perHour(hours, runSpans);
	const gates = perHour(hours, gateSpans);
	const cardHours: CardHour[] = hours.map((hour, index) => {
		const started = lastDay.filter((run) => {
			const at = Math.max(run.createdAt, first);
			return at >= hour && at < hour + HOUR_MS;
		});
		const finished = started.filter((run) => run.status === "finished").length;
		const failed = started.filter((run) => run.status === "failed").length;
		return {
			hour,
			active: active[index] ?? 0,
			gates: gates[index] ?? 0,
			costUsd: started.reduce((sum, run) => sum + run.costUsd, 0),
			tokens: started.reduce((sum, run) => sum + usedTokens(run), 0),
			finished,
			failed,
			other: started.length - finished - failed,
		};
	});
	return {
		running: runs.filter((run) => run.status === "running").length,
		sleeping: sleeping.length,
		nextWakeAt: earliest(sleeping.map((run) => run.wakeAt)),
		lastDay: {
			...dayCountsOf(lastDay),
			latestAt: lastDay.reduce<number | null>(
				(last, run) =>
					last === null || run.createdAt > last ? run.createdAt : last,
				null,
			),
		},
		dayBefore: dayCountsOf(dayBefore),
		yesterday: {
			running: atMoment(now - DAY_MS, runSpans),
			gates: atMoment(now - DAY_MS, gateSpans),
		},
		allTime: sumKnownCost(runs),
		hours: cardHours,
	};
}

function earliest(times: readonly (number | null)[]): number | null {
	return times.reduce<number | null>(
		(first, at) => (at !== null && (first === null || at < first) ? at : first),
		null,
	);
}

/**
 * How long the runs of each group were at work since `since`, the most
 * first. Only the part since `since` counts. An open run works until now.
 * The time a run slept or waited for a person is not work.
 */
function atWorkPerGroup(
	runs: readonly PlacedRun[],
	since: number,
	now: number,
): AtWorkGroup[] {
	const byLabel = new Map<string, AtWorkGroup>();
	for (const { run, group: label } of runs) {
		const { to } = spanOf(run, now);
		if (to < since) continue;
		const group = byLabel.get(label) ?? {
			label,
			runs: 0,
			started: 0,
			atWork: 0,
			longest: 0,
		};
		const atWork = lengthSince(workSpans(run, now), since);
		group.runs += 1;
		if (run.createdAt >= since) group.started += 1;
		group.atWork += atWork;
		group.longest = Math.max(group.longest, atWork);
		byLabel.set(label, group);
	}
	return [...byLabel.values()].sort((a, b) => b.atWork - a.atWork);
}

/** How many ran at once per hour over the last `range` hours, and who kept Night Shift busy. */
function activityOf(
	range: HourRange,
	runs: readonly PlacedRun[],
	now: number,
	timeZone: string,
): ActivityRange {
	const hours = lastHours(range, now, timeZone);
	const active = perHour(
		hours,
		runs.map(({ run }) => workSpans(run, now)),
	);
	const since = hours[0] ?? now;
	return {
		hours: range,
		perHour: hours.map((hour, index) => ({
			hour,
			active: active[index] ?? 0,
		})),
		peak: Math.max(0, ...active),
		busy: active.filter((count) => count > 0).length,
		started: runs.filter(({ run }) => run.createdAt >= since).length,
		groups: topRows(atWorkPerGroup(runs, since, now)),
	};
}

/** The latest night with runs, its newest runs first. */
function lastNightOf(runs: readonly PlacedRun[]): NightOutput | null {
	const newest = runs.reduce<PlacedRun | undefined>(
		(latest, placed) =>
			latest === undefined || placed.run.createdAt > latest.run.createdAt
				? placed
				: latest,
		undefined,
	);
	if (!newest) return null;
	const ofNight = runs
		.filter(({ night }) => night === newest.night)
		.sort((a, b) => b.run.createdAt - a.run.createdAt);
	return {
		night: newest.night,
		runs: ofNight.length,
		cost: sumKnownCost(ofNight.map(({ run }) => run)),
		tokens: ofNight.reduce((sum, { run }) => sum + usedTokens(run), 0),
		latest: ofNight
			.slice(0, OVERVIEW_ROWS)
			.map(({ run, group }) => ({ ...run, group })),
	};
}

/** The wake-ups and stop times still to come, the soonest first. */
function upNextOf(runs: readonly RunSummary[], now: number): UpcomingRun[] {
	return runs
		.flatMap((run): UpcomingRun[] => {
			if (run.status === "sleeping" && run.wakeAt) {
				return [
					{ kind: "wake", at: run.wakeAt, runId: run.id, title: run.title },
				];
			}
			if (run.status === "running" && run.stopAt) {
				return [
					{ kind: "stop", at: run.stopAt, runId: run.id, title: run.title },
				];
			}
			return [];
		})
		.filter((item) => item.at >= now)
		.sort((a, b) => a.at - b.at)
		.slice(0, OVERVIEW_ROWS);
}

/**
 * The dashboard of `runs`: the stat cards and their details for every
 * range a toggle offers, what the latest night produced, what comes next,
 * and (for one project) the health of its flows.
 */
export function summarizeDashboard(
	runs: readonly RunSummary[],
	options: DashboardOptions,
): DashboardSummary {
	const { now, timeZone, scope } = options;
	const group = groupOf(scope);
	const placed: PlacedRun[] = runs.map((run) => ({
		run,
		night: nightOf(run.createdAt, timeZone),
		group: group(run),
	}));
	const gates = askedGates(placed, now, timeZone);
	const open = placed
		.filter(({ run }) => isOpen(run))
		.sort((a, b) => a.run.createdAt - b.run.createdAt);
	return {
		at: now,
		cards: cardsOf(runs, now, timeZone),
		recent: [...runs]
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, OVERVIEW_ROWS),
		open: {
			...topRows(open.map(({ run, group }) => toDashboardRun(run, group))),
			running: open.filter(({ run }) => run.status === "running").length,
			nextWakeAt: earliest(open.map(({ run }) => run.wakeAt)),
		},
		activity: HOUR_RANGES.map((range) =>
			activityOf(range, placed, now, timeZone),
		),
		nights: NIGHT_RANGES.map((range) => ({
			...nightsRange(range, placed, gates, now, timeZone),
			flows:
				scope.kind === "project"
					? flowHealthRows(scope.flows, runs, now, timeZone, range)
					: null,
		})),
		healthNights: FLOW_HEALTH_NIGHTS,
		lastNight: lastNightOf(placed),
		upNext: upNextOf(runs, now),
		flowHealth:
			scope.kind === "project"
				? flowHealthRows(scope.flows, runs, now, timeZone)
				: null,
	};
}
