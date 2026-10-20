/** The query and mutation options of schedules, and how often they poll. */

import { orpc } from "@/shared/api";

/**
 * How often a list of schedules reads them again: the next start moves on,
 * and a schedule may have fired.
 */
const POLL_MS = 30_000;

export const scheduleQueries = {
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

export const scheduleMutations = {
	save: orpc.schedules.save.mutationOptions,
};
