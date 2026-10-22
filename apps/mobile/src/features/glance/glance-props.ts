import type {
	GlanceSnapshot,
	GlanceTone,
	RunProgress,
} from "@nightshift/client";
import { THEME } from "@nightshift/ui-native/lib/theme";

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

/** The props of a run on the lock screen (a Live Activity or an ongoing notification). */
export type RunActivityProps = {
	flow: string;
	statusText: string;
	/** The step that runs now, or "" when none does. */
	step: string;
	position: string;
	fraction: number;
	ended: boolean;
	light: string;
	dark: string;
	/** What the Live Activity says when the app has not updated it for a while. */
	staleText: string;
	ink: InkColors;
};

/** The lock-screen props of a run's progress. */
export function runActivityProps(progress: RunProgress): RunActivityProps {
	return {
		flow: progress.flow,
		statusText: progress.statusText,
		step: progress.step ?? "",
		position: progress.position,
		fraction: progress.fraction,
		ended: progress.ended,
		...TONE_COLORS[progress.tone],
		staleText: "Open Night Shift to see the latest",
		ink: INK,
	};
}
