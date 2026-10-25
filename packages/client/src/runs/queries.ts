import type { ApiQueryUtils } from "../api";

/**
 * How often a run's files are read again while it runs: an agent keeps a
 * file in the middle of a step, and no stream item says so.
 */
const ARTIFACTS_POLL_MS = 15_000;

/**
 * The query options of runs. No list polls: the live cache follows the
 * Host, and a run that starts, sleeps, wakes, moves, stops or ends, or a
 * step that starts or ends, reads the runs again (`run-changed`). After a
 * drop of the stream it reads them again too.
 */
export function createRunQueries(orpc: ApiQueryUtils) {
	return {
		/** Every runs query. Invalidate it after a run changes. */
		all: () => orpc.runs.key(),
		/** The runs of the Space, of every project. A failed read again keeps the list. */
		everyRun: () => ({
			...orpc.runs.list.queryOptions({ input: {} }),
			meta: { quietRefetchErrors: true },
		}),
		/** The runs of every project for the inbox: its sleeping runs. A failed read does not toast. */
		everyRunForInbox: () => ({
			...orpc.runs.list.queryOptions({ input: {} }),
			meta: { quietErrors: true },
		}),
		/** The runs of one project. A failed read again keeps the list. */
		ofProject: (projectId: string) => ({
			...orpc.runs.list.queryOptions({ input: { projectId } }),
			meta: { quietRefetchErrors: true },
		}),
		/** One run with its steps. */
		get: (runId: string) => orpc.runs.get.queryOptions({ input: { runId } }),
		/** The files a run's agents kept. Polls while the run runs, so a new one shows. */
		artifacts: (runId: string, live: boolean) => ({
			...orpc.runs.artifacts.queryOptions({ input: { runId } }),
			refetchInterval: live ? ARTIFACTS_POLL_MS : (false as const),
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
