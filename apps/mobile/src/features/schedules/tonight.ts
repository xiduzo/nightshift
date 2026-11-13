import {
	dayWord,
	hourOf,
	type KnownComputer,
	offlineNeeds,
	type PlannedSchedule,
	scheduleName,
} from "@nightshift/client";

import { formatTime } from "@/shared/format";
import { shownPaused } from "./schedule-words";

/** One schedule of one project, as a key: schedule ids are per project. */
export function scheduleKey(projectId: string, scheduleId: string): string {
	return `${projectId}:${scheduleId}`;
}

/** One schedule of tonight on Runs: where it runs, and whether it can. */
export type TonightEntry = PlannedSchedule & {
	key: string;
	/** The computer its runs run on. Null when the phone cannot tell. */
	computer: string | null;
	/** The computer its flow names that is offline now. Null: none is. */
	offline: string | null;
	/** Paused tonight, also while a pause is on its way. */
	paused: boolean;
	/** The run its last start began, while that run is still on its way. */
	started: { runId: string; at: number } | null;
};

/** The statuses of a run that has not ended. */
const LIVE = new Set(["running", "waiting", "sleeping"]);

/**
 * The schedules of the next 24 hours (`plan.soon`), with the computer
 * each runs on: the Host, which fires every schedule and runs it (ADR 15).
 * `flowDevices` gives the computers its flow names: a step can still run on
 * another computer. A computer is offline only when the Host says so.
 */
export function tonightEntries(
	soon: readonly PlannedSchedule[],
	known: readonly KnownComputer[],
	flowDevices: (projectId: string, flow: string) => readonly string[],
	hostName: string | null,
	now: number,
	pending: ReadonlyMap<string, "pause" | "resume">,
): TonightEntry[] {
	return soon.map((entry) => {
		const { schedule } = entry;
		const key = scheduleKey(entry.projectId, schedule.id);
		const computer = hostName;
		const ids =
			schedule.flow === undefined
				? []
				: flowDevices(entry.projectId, schedule.flow);
		const offline = offlineNeeds({ ids }, known)[0] ?? null;
		const last = schedule.last;
		const started =
			last?.kind === "fired" &&
			last.runStatus !== null &&
			LIVE.has(last.runStatus)
				? { runId: last.runId, at: last.at }
				: null;
		return {
			...entry,
			key,
			computer,
			offline,
			paused: shownPaused(schedule, now, pending.get(key)),
			started,
		};
	});
}

/**
 * When a start is, for a sentence: "at 03:00 tonight" between 18:00 and
 * 06:00 within the next day, else "tomorrow at 14:00".
 */
export function startWhen(at: number, now: number): string {
	const hour = hourOf(at);
	const night = hour >= 18 || hour < 6;
	if (night && at - now < 24 * 60 * 60 * 1000) {
		return `at ${formatTime(at)} tonight`;
	}
	return `${dayWord(at, now)} at ${formatTime(at)}`;
}

/** A computer that a schedule needs, and that is offline now. */
export type OfflineNotice = {
	key: string;
	/** "Lighthouse check needs MacBook Pro at 03:00 tonight." */
	sentence: string;
	entry: TonightEntry;
};

/**
 * The notices on Computers: each schedule that starts and whose computer is
 * offline now. A paused schedule, or one whose run is on its way, needs
 * nothing.
 */
export function offlineNotices(
	entries: readonly TonightEntry[],
	now: number,
): OfflineNotice[] {
	return entries.flatMap((entry) => {
		const at = entry.schedule.nextAt;
		const { offline } = entry;
		if (offline === null || entry.paused || entry.started || at === null) {
			return [];
		}
		const name = scheduleName(entry.schedule);
		const when = startWhen(at, now);
		return [
			{
				key: entry.key,
				sentence: `${name} needs ${offline} ${when}.`,
				entry,
			},
		];
	});
}
