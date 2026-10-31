import type {
	GlanceSnapshot,
	GlanceTone,
	RunProgress,
} from "@nightshift/client";
import { THEME } from "@nightshift/ui-native/lib/theme";

import { formatTime } from "@/shared/format";

/** A color for the light and for the dark color scheme. */
export type SchemeColor = { light: string; dark: string };

/** Both color schemes of one theme color (`@nightshift/ui-native/lib/theme`). */
function schemeColor(
	key: Exclude<keyof (typeof THEME)["light"], "radius">,
): SchemeColor {
	return { light: THEME.light[key], dark: THEME.dark[key] };
}

/**
 * The run status colors of the app. A widget and a Live Activity render
 * outside the app, so they get the colors in their props and pick one by
 * the color scheme.
 */
const TONE_COLORS: Record<GlanceTone, SchemeColor> = {
	running: schemeColor("statusRunning"),
	finished: schemeColor("statusFinished"),
	stopped: schemeColor("statusStopped"),
	failed: schemeColor("statusFailed"),
	waiting: schemeColor("statusWaiting"),
	sleeping: schemeColor("statusSleeping"),
};

/** The text colors outside the app: the main text and the muted text. */
export type InkColors = { text: SchemeColor; muted: SchemeColor };

const INK: InkColors = {
	text: schemeColor("foreground"),
	muted: schemeColor("mutedForeground"),
};

/** One run on the home screen widget. */
export type WidgetRun = {
	id: string;
	flow: string;
	statusText: string;
	light: string;
	dark: string;
};

/** The props of the home screen widget: plain values only, ready to show. */
export type HomeWidgetProps = {
	waiting: number;
	waitingText: string;
	noRunsText: string;
	runs: WidgetRun[];
	ink: InkColors;
};

/**
 * The widget's props from a snapshot. Null is a phone that is not signed
 * in: the widget shows no count and no runs of a Host it cannot read.
 */
export function homeWidgetProps(
	snapshot: GlanceSnapshot | null,
): HomeWidgetProps {
	if (!snapshot) {
		return {
			waiting: 0,
			waitingText: "Open Night Shift to connect to your Host",
			noRunsText: "",
			runs: [],
			ink: INK,
		};
	}
	return {
		waiting: snapshot.waiting,
		waitingText: snapshot.waitingText,
		noRunsText: snapshot.noRunsText,
		runs: snapshot.runs.map((run) => ({
			id: run.id,
			flow: run.flow,
			statusText: run.statusText,
			...TONE_COLORS[run.tone],
		})),
		ink: INK,
	};
}

/** The SF Symbol of each status on the lock screen and in the Dynamic Island. */
const TONE_SYMBOLS: Record<GlanceTone, string> = {
	running: "arrow.triangle.2.circlepath",
	waiting: "hand.raised.fill",
	finished: "checkmark.circle.fill",
	failed: "xmark.circle.fill",
	stopped: "pause.circle.fill",
	sleeping: "moon.zzz.fill",
};

/** The props of a run on the lock screen (a Live Activity or an ongoing notification). */
export type RunActivityProps = {
	flow: string;
	/** The status in one word or two: "Running", "Needs you", "Failed". */
	statusText: string;
	/** The line above the flow: "Running · Step 2 of 4", "Needs you · Answer by 07:30". */
	headline: string;
	/** The step that runs or waits now, or "" when none does. */
	step: string;
	position: string;
	/** "2/4" while the run is on its way: the Dynamic Island has room for little. */
	short: string;
	fraction: number;
	ended: boolean;
	/** The SF Symbol of the status. */
	symbol: string;
	/** When the run started, in epoch ms: the time at work counts from here. */
	startedAt: number;
	/** When the run ended, or 0: the time at work stops there. */
	endedAt: number;
	/** When the open Gate chooses for you, or 0: the time left counts down to it. */
	deadlineAt: number;
	light: string;
	dark: string;
	/** What the Live Activity says when the app has not updated it for a while. */
	staleText: string;
	ink: InkColors;
};

/** "2/4" from "Step 2 of 4". Empty before the first step. */
function shortPosition(position: string): string {
	const match = /^Step (\d+) of (\d+)$/.exec(position);
	return match ? `${match[1]}/${match[2]}` : "";
}

/**
 * The lock-screen props of a run's progress. A run at a Gate says "Needs
 * you", as the app does, and when the Gate chooses by itself. The props
 * are plain values: dates go as epoch ms, 0 for none.
 */
export function runActivityProps(
	progress: RunProgress,
	time: (epochMs: number) => string = formatTime,
): RunActivityProps {
	const waiting = progress.status === "waiting";
	const statusText = waiting ? "Needs you" : progress.statusText;
	const detail = waiting
		? progress.deadlineAt
			? `Answer by ${time(progress.deadlineAt)}`
			: "Waits for your answer"
		: progress.position;
	return {
		flow: progress.flow,
		statusText,
		headline: `${statusText} · ${detail}`,
		step: progress.step ?? "",
		position: progress.position,
		short: progress.ended ? "" : shortPosition(progress.position),
		fraction: progress.fraction,
		ended: progress.ended,
		symbol: TONE_SYMBOLS[progress.tone],
		startedAt: progress.startedAt,
		endedAt: progress.endedAt ?? 0,
		deadlineAt: progress.deadlineAt ?? 0,
		...TONE_COLORS[progress.tone],
		staleText: "Open Night Shift to see the latest",
		ink: INK,
	};
}
