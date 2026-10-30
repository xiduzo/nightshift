import type { ApiQueryUtils } from "../api";
import type { DashboardInput } from "./types";

/**
 * How often the dashboard reads its numbers again by itself: "the last 24
 * hours" moves on. What happens to the runs reaches it at once: the live
 * cache reads the numbers again each time it reads the runs again, on the
 * web and on the phone.
 */
const POLL_MS = 5 * 60_000;

/**
 * The time zone of this screen (IANA, such as `Europe/Amsterdam`): the
 * dashboard counts nights from noon to noon on the reader's clock, and a
 * schedule someone saves runs on it.
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
		 * Space (`everySpace`). Polls every 5 minutes. A failed background poll
		 * keeps the numbers.
		 */
		summary: (input: DashboardInput = {}) => ({
			...orpc.dashboard.summary.queryOptions({
				input: { ...input, timeZone: readerTimeZone() },
			}),
			refetchInterval: POLL_MS,
			meta: { quietRefetchErrors: true },
		}),
		/** One flow of a project in detail. Polls every 5 minutes. */
		flow: (projectId: string, flowName: string) => ({
			...orpc.dashboard.flow.queryOptions({
				input: { projectId, flowName, timeZone: readerTimeZone() },
			}),
			refetchInterval: POLL_MS,
			meta: { quietRefetchErrors: true },
		}),
	};
}
