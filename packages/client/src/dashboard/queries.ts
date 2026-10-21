import type { ApiQueryUtils } from "../api";
import type { DashboardInput } from "./types";

/** How often the dashboard reads its numbers again while a run is on its way. */
const ACTIVE_POLL_MS = 5000;
/** How often it reads them again otherwise: "the last 24 hours" moves on. */
const IDLE_POLL_MS = 60_000;

/**
 * The time zone of this screen (IANA, such as `Europe/Amsterdam`): the
 * dashboard counts nights from noon to noon on the reader's clock.
 */
export function readerTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** The query options of the dashboard, and how often it polls. */
export function createDashboardQueries(orpc: ApiQueryUtils) {
	return {
		/** Every dashboard query. Invalidate it after a run changes. */
		all: () => orpc.dashboard.key(),
		/**
		 * The numbers of the Space, of one project (`projectId`), or of every
		 * Space (`everySpace`). Polls fast while a run is open, else once a
		 * minute. A failed background poll keeps the numbers.
		 */
		summary: (input: DashboardInput = {}) => ({
			...orpc.dashboard.summary.queryOptions({
				input: { ...input, timeZone: readerTimeZone() },
			}),
			refetchInterval: (query: {
				state: { data?: { open: { count: number } } | undefined };
			}) =>
				(query.state.data?.open.count ?? 0) > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS,
			meta: { quietRefetchErrors: true },
		}),
		/** One flow of a project in detail. Polls once a minute. */
		flow: (projectId: string, flowName: string) => ({
			...orpc.dashboard.flow.queryOptions({
				input: { projectId, flowName, timeZone: readerTimeZone() },
			}),
			refetchInterval: IDLE_POLL_MS,
			meta: { quietRefetchErrors: true },
		}),
	};
}
