import {
	flowLabel,
	formatTime,
	type RunStatus,
	type RunSummary,
	scheduleName,
	scheduleNudges,
} from "@nightshift/client";

import type { TonightEntry } from "@/features/schedules";

/** The lines of the Runs agenda without React Native: one timeline from now to tomorrow morning. */

const MINUTE = 60_000;

/**
 * The look of a line, its icon and color: `running` for a run at work,
 * `offline` for a schedule whose computer is offline, `quiet` for the rest.
 */
export type Rail = "running" | "offline" | "quiet";

/** A run on its way, under Now. Tap opens it, Stop is its action. */
export type RunLine = {
	kind: "run";
	key: string;
	runId: string;
	status: RunStatus;
	/** When it started. */
	at: number;
	title: string;
	caption: string;
	rail: Rail;
};

/** What the action of a schedule line does. */
export type ScheduleAction = "pause" | "undo" | "open";

/** A schedule of tonight. Its action pauses it, undoes the pause, or opens its run. */
export type ScheduleLine = {
	kind: "schedule";
	key: string;
	entry: TonightEntry;
	/** When it starts, or when its run started. Null when it does not start tonight. */
	at: number | null;
	title: string;
	caption: string;
	rail: Rail;
	/** Paused tonight: the line shows faded. */
	muted: boolean;
	/** The action. Null: none. */
	action: ScheduleAction | null;
	/** The run its start began, while that run is on its way. */
	runId: string | null;
	/**
	 * Run now, its other action: `yes`, `offline` when the computer it needs
	 * is offline, `no` when the schedule cannot run now or its run is on its way.
	 */
	runNow: "yes" | "offline" | "no";
};

/** "Running for 42 min", "Running for 1 h 5 min", "Sleeping until 05:00". */
export function runCaption(
	run: Pick<RunSummary, "status" | "createdAt" | "wakeAt">,
	now: number,
): string {
	if (run.status === "sleeping") {
		return run.wakeAt === null
			? "Sleeping"
			: `Sleeping until ${formatTime(run.wakeAt)}`;
	}
	const minutes = Math.floor(Math.max(0, now - run.createdAt) / MINUTE);
	if (minutes < 1) return "Started just now";
	if (minutes < 60) return `Running for ${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0
		? `Running for ${hours} h`
		: `Running for ${hours} h ${rest} min`;
}

/** The runs on their way, the one that started first on top. */
export function nowLines(runs: readonly RunSummary[], now: number): RunLine[] {
	return [...runs]
		.sort((a, b) => a.createdAt - b.createdAt)
		.map((run) => ({
			kind: "run",
			key: run.id,
			runId: run.id,
			status: run.status,
			at: run.createdAt,
			title: flowLabel(run),
			caption: runCaption(run, now),
			rail: "running",
		}));
}

/** The caption of a schedule: why it will not start as planned, else its project. */
function scheduleCaption(entry: TonightEntry): string {
	if (entry.started) return `Started at ${formatTime(entry.started.at)}`;
	if (entry.paused) return "Paused tonight";
	if (entry.offline !== null) return `${entry.offline} is offline`;
	return entry.projectName;
}

/**
 * The schedules of tonight, in the order of `useTonight`: soonest first,
 * the paused ones last. A run on its way opens. A paused one has Undo,
 * and no Run now.
 * Another has Pause when it starts on its own at a time.
 */
export function tonightLines(
	entries: readonly TonightEntry[],
	now: number,
): ScheduleLine[] {
	return entries.map((entry) => {
		const { schedule, started, paused, offline } = entry;
		const allowed = scheduleNudges(schedule, now);
		const action: ScheduleAction | null = started
			? "open"
			: paused
				? "undo"
				: allowed.pause
					? "pause"
					: null;
		// A paused one offers Undo only, as before the agenda: Run now waits until you undo.
		const runNow =
			started || paused || !allowed.runNow
				? "no"
				: offline !== null
					? "offline"
					: "yes";
		return {
			kind: "schedule",
			key: entry.key,
			entry,
			at: started ? started.at : paused ? null : schedule.nextAt,
			title: scheduleName(schedule),
			caption: scheduleCaption(entry),
			rail: started
				? "running"
				: offline !== null && !paused
					? "offline"
					: "quiet",
			muted: paused && !started,
			action,
			runId: started?.runId ?? null,
			runNow,
		};
	});
}

/**
 * How a row shows its actions: `swipe` on iOS (swipe actions), `hold` on
 * Android (a long-press menu).
 */
export type Gesture = "swipe" | "hold";

/**
 * The hint under Now: how to stop a run, and that the list ends at
 * `limit` runs. Nothing without runs.
 */
export function nowHint(
	runs: number,
	limit: number,
	gesture: Gesture,
): string | undefined {
	if (runs === 0) return undefined;
	const stop =
		gesture === "swipe"
			? "Swipe a run left to stop it."
			: "Hold a run to stop it.";
	return runs >= limit ? `${stop} Shows ${limit} runs at most.` : stop;
}

/**
 * The hint under Tonight: how to pause a schedule and how to run one now,
 * for what the lines offer. Nothing when no line offers either.
 */
export function tonightHint(
	lines: readonly Pick<ScheduleLine, "action" | "runNow">[],
	gesture: Gesture,
): string | undefined {
	const pause = lines.some(
		(line) => line.action === "pause" || line.action === "undo",
	);
	const run = lines.some((line) => line.runNow === "yes");
	if (gesture === "swipe") {
		if (pause && run) {
			return "Swipe left to pause a schedule tonight. Swipe right to run it now.";
		}
		if (pause) return "Swipe left to pause a schedule tonight.";
		if (run) return "Swipe right to run a schedule now.";
		return undefined;
	}
	if (pause && run) return "Hold a schedule to pause it tonight or run it now.";
	if (pause) return "Hold a schedule to pause it tonight.";
	if (run) return "Hold a schedule to run it now.";
	return undefined;
}
