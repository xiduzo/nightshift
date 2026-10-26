import { type OpenGate, waitingForYou } from "../gates";
import {
	flowLabel,
	type RunStatus,
	type RunSummary,
	runStatusLabel,
} from "../runs";
import { type GlanceTone, glanceTone } from "./tone";

/** How many runs a glance shows: the newest. A screen reads only these. */
export const GLANCE_RUNS = 3;

/** One run on a glance: its flow and status, nothing more. */
export type GlanceRun = {
	id: string;
	flow: string;
	status: RunStatus;
	statusText: string;
	tone: GlanceTone;
};

/**
 * What the home screen widget shows: how many Gates wait for you and the
 * latest runs with their status. It holds only counts, flow names and
 * statuses, never what a Gate asks or what a run started with: a widget
 * shows on a locked phone too. Every text is ready to show, because a
 * widget cannot format anything itself.
 */
export type GlanceSnapshot = {
	waiting: number;
	/** "Nothing waits for you", "1 Gate waits for you", "3 Gates wait for you". */
	waitingText: string;
	/** The newest runs first, at most three. */
	runs: GlanceRun[];
	/** What the widget shows instead of runs when there are none. */
	noRunsText: string;
};

/** The words for a count of Gates that wait for you. */
export function waitingText(count: number): string {
	if (count === 0) return "Nothing waits for you";
	return count === 1 ? "1 Gate waits for you" : `${count} Gates wait for you`;
}

/**
 * The widget's snapshot from the open Gates (of every Space) and the runs
 * (of the active Space). Gates the person may not answer do not count.
 */
export function glanceSnapshot({
	gates,
	runs,
}: {
	gates: readonly Pick<OpenGate, "canAnswer">[];
	runs: readonly Pick<RunSummary, "id" | "flowName" | "status" | "createdAt">[];
}): GlanceSnapshot {
	const waiting = waitingForYou(gates);
	const latest = [...runs]
		.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
		.slice(0, GLANCE_RUNS)
		.map((run) => ({
			id: run.id,
			flow: flowLabel(run),
			status: run.status,
			statusText: runStatusLabel(run.status),
			tone: glanceTone(run.status),
		}));
	return {
		waiting,
		waitingText: waitingText(waiting),
		runs: latest,
		noRunsText: "No runs yet",
	};
}
