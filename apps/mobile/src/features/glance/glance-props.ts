import type {
	GlanceSnapshot,
	GlanceTone,
	RunProgress,
} from "@nightshift/client";

/**
 * The run status colors of the app (`--color-status-*` in ui-native's
 * `global.css`), in hex for light and dark. A widget and a Live Activity
 * render outside the app, so they get the colors in their props and pick
 * one by the color scheme. Change a value there and here together.
 */
const TONE_COLORS: Record<GlanceTone, { light: string; dark: string }> = {
	running: { light: "#0064b9", dark: "#5db2f7" },
	finished: { light: "#007840", dark: "#56d089" },
	stopped: { light: "#555555", dark: "#ababab" },
	failed: { light: "#c51e21", dark: "#fe6c66" },
	waiting: { light: "#975800", dark: "#f7bc50" },
	sleeping: { light: "#61529f", dark: "#b0a8e7" },
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
	};
}
