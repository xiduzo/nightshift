import type { RunStatus } from "../runs";

/**
 * The color family of a run status on a widget, a Live Activity or a
 * notification: the same families as the status badges in the app.
 * Interrupted looks like stopped.
 */
export type GlanceTone =
	| "running"
	| "waiting"
	| "sleeping"
	| "finished"
	| "failed"
	| "stopped";

const TONES: Record<RunStatus, GlanceTone> = {
	running: "running",
	waiting: "waiting",
	sleeping: "sleeping",
	finished: "finished",
	failed: "failed",
	stopped: "stopped",
	interrupted: "stopped",
};

/** The color family of a run status. */
export function glanceTone(status: RunStatus): GlanceTone {
	return TONES[status];
}
