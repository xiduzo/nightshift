import {
	dayWord,
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

/** One schedule on Watch, under Tonight: where it runs, and whether it can. */
export type TonightEntry = PlannedSchedule & {
	key: string;
	/** The computer its runs run on. Null when the phone cannot tell. */
	computer: string | null;
	/** That computer is offline now. */
	offline: boolean;
	/** Paused tonight, also while a pause is on its way. */
	paused: boolean;
	/** The run its last start began, while that run is still on its way. */
	started: { runId: string; at: number } | null;
};

/** The statuses of a run that has not ended. */
const LIVE = new Set(["running", "waiting", "sleeping"]);

/**
 * The schedules of the next 24 hours (`plan.soon`), with the computer
 * each runs on: its own `device`, else the Host, which fires every
 * schedule. A computer is offline only when the Host says so.
 */
export function tonightEntries(
	soon: readonly PlannedSchedule[],
	known: readonly KnownComputer[],
	hostName: string | null,
	now: number,
	pending: ReadonlyMap<string, "pause" | "resume">,
): TonightEntry[] {
	return soon.map((entry) => {
		const { schedule } = entry;
		const key = scheduleKey(entry.projectId, schedule.id);
		const computer = schedule.device ?? hostName;
		const offline =
			computer !== null &&
			offlineNeeds({ names: [computer], ids: [] }, known).length > 0;
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

/** How many of them start tonight: the ones not paused. */
export function tonightHint(entries: readonly TonightEntry[]): string {
	const starting = entries.filter((entry) => !entry.paused).length;
	if (starting === 0) return "Nothing runs tonight.";
	return starting === 1
		? "1 flow runs tonight."
		: `${starting} flows run tonight.`;
}

/**
 * When a start is, for a sentence: "at 03:00 tonight" between 18:00 and
 * 06:00 within the next day, else "tomorrow at 14:00".
 */
export function startWhen(at: number, now: number): string {
	const hour = new Date(at).getHours();
	const night = hour >= 18 || hour < 6;
	if (night && at - now < 24 * 60 * 60 * 1000) {
		return `at ${formatTime(at)} tonight`;
	}
	return `${dayWord(at, now)} at ${formatTime(at)}`;
}

/** A computer that a schedule needs, and that is offline now. */
export type OfflineNotice = {
	key: string;
	/** "MacBook Pro is offline". */
	title: string;
	/** "Lighthouse check needs it at 03:00 tonight." */
	caption: string;
	/** "Lighthouse check needs MacBook Pro at 03:00 tonight." */
	sentence: string;
	entry: TonightEntry;
};

/**
 * The notices on Watch: each schedule that starts and whose computer is
 * offline now. A paused schedule, or one whose run is on its way, needs
 * nothing.
 */
export function offlineNotices(
	entries: readonly TonightEntry[],
	now: number,
): OfflineNotice[] {
	return entries.flatMap((entry) => {
		const at = entry.schedule.nextAt;
		if (!entry.offline || entry.paused || entry.started || at === null) {
			return [];
		}
		const name = scheduleName(entry.schedule);
		const when = startWhen(at, now);
		return [
			{
				key: entry.key,
				title: `${entry.computer} is offline`,
				caption: `${name} needs it ${when}.`,
				sentence: `${name} needs ${entry.computer} ${when}.`,
				entry,
			},
		];
	});
}
