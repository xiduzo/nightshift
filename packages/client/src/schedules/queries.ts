import type { ApiQueryUtils } from "../api";

/**
 * How often a list of schedules reads them again: the next start moves on
 * when a schedule skips a start. A schedule that fires starts a run, and
 * the live cache reads the schedules again with the runs.
 */
const POLL_MS = 60_000;

/** The query options of schedules, and how often they poll. */
export function createScheduleQueries(orpc: ApiQueryUtils) {
	return {
		/** Every schedules query. Invalidate it after a schedule changes. */
		all: () => orpc.schedules.key(),
		/** The schedules of one project, with the next start and the last result of each. */
		list: (projectId: string) =>
			orpc.schedules.list.queryOptions({ input: { projectId } }),
		/** The schedules of one project. Polls; a failed background poll keeps the list. */
		listLive: (projectId: string) => ({
			...orpc.schedules.list.queryOptions({ input: { projectId } }),
			refetchInterval: POLL_MS,
			meta: { quietRefetchErrors: true },
		}),
		/** The next starts of a cron expression. */
		preview: (cron: string) =>
			orpc.schedules.preview.queryOptions({ input: { cron } }),
	};
}

/** The mutation options of schedules. */
export function createScheduleMutations(orpc: ApiQueryUtils) {
	return {
		save: orpc.schedules.save.mutationOptions,
	};
}
