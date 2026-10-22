import type { ApiQueryUtils } from "../api";

/**
 * How often a project's runs poll while one of them is on its way. The
 * notifications stream invalidates the runs when a Gate opens or closes
 * and when a run ends: this catches the rest (a run that sleeps or stops).
 */
const ACTIVE_POLL_MS = 15_000;
/** How often the inbox looks for sleeping runs and when they wake. */
const INBOX_POLL_MS = 15_000;

/** Polls a list of runs while one of them is on its way. */
function pollWhileActive(query: {
	state: { data?: { status: string }[] | undefined };
}): number | false {
	return query.state.data?.some(
		(run) =>
			run.status === "running" ||
			run.status === "waiting" ||
			run.status === "sleeping",
	)
		? ACTIVE_POLL_MS
		: false;
}

/** The query options of runs, and how often each run list polls. */
export function createRunQueries(orpc: ApiQueryUtils) {
	return {
		/** Every runs query. Invalidate it after a run changes. */
		all: () => orpc.runs.key(),
		/** The runs of every project. */
		everyRun: () => orpc.runs.list.queryOptions({ input: {} }),
		/**
		 * The runs of the Space, of every project. Polls while a run is on its
		 * way, like `ofProjectLive`. A failed background poll keeps the list.
		 */
		everyRunLive: () => ({
			...orpc.runs.list.queryOptions({ input: {} }),
			refetchInterval: pollWhileActive,
			meta: { quietRefetchErrors: true },
		}),
		/** The runs of one project. */
		ofProject: (projectId: string) =>
			orpc.runs.list.queryOptions({ input: { projectId } }),
		/**
		 * One project's runs. Polls while a run is on its way, so one that
		 * sleeps or stops shows it. A Gate and a run's end come through the
		 * notifications stream. A failed background poll keeps the list.
		 */
		ofProjectLive: (projectId: string) => ({
			...orpc.runs.list.queryOptions({ input: { projectId } }),
			refetchInterval: pollWhileActive,
			meta: { quietRefetchErrors: true },
		}),
		/** The runs of every project for the inbox. Polls; a failed poll does not toast. */
		everyRunForInbox: () => ({
			...orpc.runs.list.queryOptions({ input: {} }),
			refetchInterval: INBOX_POLL_MS,
			meta: { quietErrors: true },
		}),
		/** One run with its steps. */
		get: (runId: string) => orpc.runs.get.queryOptions({ input: { runId } }),
		/** The files a run's agents kept. Polls while the run runs, so a new one shows. */
		artifacts: (runId: string, live: boolean) => ({
			...orpc.runs.artifacts.queryOptions({ input: { runId } }),
			refetchInterval: live ? ACTIVE_POLL_MS : (false as const),
			meta: { quietRefetchErrors: true },
		}),
		/** The person's Devices for the project, online or not: a node's Device, Move to. */
		devices: (projectId: string) =>
			orpc.runs.devices.queryOptions({ input: { projectId } }),
		/** The person's Devices a run of the project can run on, this computer first. */
		placements: (projectId: string) =>
			orpc.runs.placements.queryOptions({ input: { projectId } }),
	};
}

/** The mutation options of runs. */
export function createRunMutations(orpc: ApiQueryUtils) {
	return {
		start: orpc.runs.start.mutationOptions,
		stop: orpc.runs.stop.mutationOptions,
		resume: orpc.runs.resume.mutationOptions,
		signal: orpc.runs.signal.mutationOptions,
		restartStep: orpc.runs.restartStep.mutationOptions,
		rerun: orpc.runs.rerun.mutationOptions,
		move: orpc.runs.move.mutationOptions,
	};
}
