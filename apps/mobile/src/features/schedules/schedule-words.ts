import {
	dayWord,
	isPausedTonight,
	type NudgeProblem,
	nextPlanned,
	type SchedulePlan,
	type ScheduleResult,
	type ScheduleSummary,
	scheduleName,
	scheduleWhen,
} from "@nightshift/client";

import { formatTime } from "@/shared/format";
import { type Look, runStatusLook } from "@/shared/tone";

/** A schedule that skips its starts tonight. */
export const PAUSED_TONIGHT: Look = {
	tone: "neutral",
	icon: "moon",
	label: "Paused tonight",
};

/** "Today 23:00", "Tomorrow 02:00", "Friday 22:00": a start after `now`. */
export function startText(at: number, now: number): string {
	const day = dayWord(at, now);
	return `${day.charAt(0).toUpperCase()}${day.slice(1)} ${formatTime(at)}`;
}

/**
 * When the schedule starts next, short, for the end of its row: a time,
 * or why it does not start on its own.
 */
export function nextText(schedule: ScheduleSummary, now: number): string {
	if (!schedule.enabled) return "Off";
	if (schedule.webhook) return "On a webhook";
	if (schedule.nextAt === null) return "No next start";
	return startText(schedule.nextAt, now);
}

/** When it starts, with its stop time: "At 22:00, every day, stops 06:00". */
export function whenLine(schedule: ScheduleSummary): string {
	const when = scheduleWhen(schedule);
	return schedule.stopAt ? `${when}, stops ${schedule.stopAt}` : when;
}

/**
 * How the last start went, as a status: the status of the run it
 * started, "Did not start", or "Skipped". Null before the first start.
 */
export function lastLook(last: ScheduleResult | null): Look | null {
	if (!last) return null;
	if (last.kind === "fired") {
		return last.runStatus
			? runStatusLook(last.runStatus)
			: { tone: "neutral", icon: "circle-dot", label: "Started" };
	}
	if (last.kind === "failed") {
		return { tone: "failed", icon: "circle-x", label: "Did not start" };
	}
	return { tone: "neutral", icon: "circle-dashed", label: "Skipped" };
}

/** The status of its row: paused tonight, else how the last start went. */
export function rowLook(
	schedule: ScheduleSummary,
	paused: boolean,
): Look | undefined {
	if (paused) return PAUSED_TONIGHT;
	return lastLook(schedule.last) ?? undefined;
}

/** Whether the row shows it paused: a pause or a resume on its way wins over the list. */
export function shownPaused(
	schedule: ScheduleSummary,
	now: number,
	pending: "pause" | "resume" | undefined,
): boolean {
	if (pending === "pause") return true;
	if (pending === "resume") return false;
	return isPausedTonight(schedule, now);
}

/** The line under the title of Schedules: "2 start in the next 24 hours · 1 paused tonight". */
export function planSummary(plan: SchedulePlan, now: number): string {
	const paused = plan.soon.filter((entry) =>
		isPausedTonight(entry.schedule, now),
	).length;
	const starting = plan.soon.length - paused;
	const parts = [
		starting === 0
			? "Nothing starts in the next 24 hours"
			: starting === 1
				? "1 starts in the next 24 hours"
				: `${starting} start in the next 24 hours`,
	];
	if (paused > 0) parts.push(`${paused} paused tonight`);
	return parts.join(" · ");
}

/**
 * The next start of the Space, for its row on Home: "nightly-review,
 * today 23:00". Null when nothing starts on a clock.
 */
export function nextStartLine(plan: SchedulePlan, now: number): string | null {
	const next = nextPlanned(plan, now);
	if (!next || next.schedule.nextAt === null) return null;
	const at = next.schedule.nextAt;
	return `${scheduleName(next.schedule)}, ${dayWord(at, now)} ${formatTime(at)}`;
}

export type Nudge = "pause" | "resume" | "runNow";

const TITLES: Record<Nudge, string> = {
	pause: "Pause tonight did not work",
	resume: "Resume tonight did not work",
	runNow: "The run did not start",
};

/**
 * What to say when a nudge did not work: what happened, and how to fix
 * it. The Host's own words say why, except for an older Host, which does
 * not know the nudge at all.
 */
export function problemCopy(
	nudge: Nudge,
	problem: NudgeProblem,
	message: string,
): { title: string; message: string; fix?: string } {
	const title = TITLES[nudge];
	switch (problem) {
		case "host-outdated":
			return {
				title: "Your Host cannot do this yet",
				message:
					"Pause tonight and Run now need a newer Night Shift on your Host.",
				fix: "Update Night Shift on your Host. Until then, change schedules on your computer.",
			};
		case "busy":
			return { title, message, fix: "Open Runs to follow that run." };
		case "refused":
			return { title, message };
		case "forbidden":
			return {
				title,
				message,
				fix: "Ask an owner of this Space for a role that can start and stop runs.",
			};
		case "gone":
			return {
				title,
				message,
				fix: "Go back to Schedules to see the list again.",
			};
		case "other":
			return {
				title,
				message,
				fix: "Check that this phone is online, then try again.",
			};
	}
}
