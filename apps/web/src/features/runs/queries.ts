/**
 * The query and mutation options of runs, and how often each run list polls.
 *
 * Flows (start a run) and gates (the inbox) sit below runs and use these
 * too. They import this file through a peer port
 * (`scripts/check-verticals.ts`), because the runs vertical imports them.
 */

import { orpc } from "@/shared/api";

/** How often a project's runs poll while one of them is on its way. */
const ACTIVE_POLL_MS = 5000;
/** How often the inbox looks for sleeping runs and when they wake. */
const INBOX_POLL_MS = 15_000;
/** How often the night notifications read the runs for a change of status. */
const NOTIFY_POLL_MS = 10_000;

export const runQueries = {
	/** Every runs query. Invalidate it after a run changes. */
	all: () => orpc.runs.key(),
	/** The runs of every project. */
	everyRun: () => orpc.runs.list.queryOptions({ input: {} }),
	/** The runs of one project. */
	ofProject: (projectId: string) =>
		orpc.runs.list.queryOptions({ input: { projectId } }),
	/**
	 * One project's runs. Polls while a run is on its way, so one that reaches
	 * a Gate shows as waiting. A failed background poll keeps the list.
	 */
	ofProjectLive: (projectId: string) => ({
		...orpc.runs.list.queryOptions({ input: { projectId } }),
		refetchInterval: (query: {
			state: { data?: { status: string }[] | undefined };
		}) =>
			query.state.data?.some(
				(run) =>
					run.status === "running" ||
					run.status === "waiting" ||
					run.status === "sleeping",
			)
				? ACTIVE_POLL_MS
				: false,
		meta: { quietRefetchErrors: true },
	}),
	/** The runs of every project for the inbox. Polls; a failed poll does not toast. */
	everyRunForInbox: () => ({
		...orpc.runs.list.queryOptions({ input: {} }),
		refetchInterval: INBOX_POLL_MS,
		meta: { quietErrors: true },
	}),
	/** The runs of every project for the night notifications. Polls; a failed poll does not toast. */
	everyRunForNotifications: () => ({
		...orpc.runs.list.queryOptions({ input: {} }),
		refetchInterval: NOTIFY_POLL_MS,
		meta: { quietErrors: true },
	}),
	/** One run with its steps. */
	get: (runId: string) => orpc.runs.get.queryOptions({ input: { runId } }),
	/** The person's Devices for the project, online or not: a node's Device, Move to. */
	devices: (projectId: string) =>
		orpc.runs.devices.queryOptions({ input: { projectId } }),
	/** The person's Devices a run of the project can run on, this computer first. */
	placements: (projectId: string) =>
		orpc.runs.placements.queryOptions({ input: { projectId } }),
};

export const runMutations = {
	start: orpc.runs.start.mutationOptions,
	stop: orpc.runs.stop.mutationOptions,
	resume: orpc.runs.resume.mutationOptions,
	signal: orpc.runs.signal.mutationOptions,
	restartStep: orpc.runs.restartStep.mutationOptions,
	rerun: orpc.runs.rerun.mutationOptions,
	move: orpc.runs.move.mutationOptions,
};
