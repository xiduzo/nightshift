import type { ApiQueryUtils } from "../api";

/**
 * How often the inbox and its badge read the open Gates again. The app
 * follows `notifications.watch` (`followNotifications`) and reads them again
 * on each item: this is only the fallback while that stream is down.
 */
const FALLBACK_POLL_MS = 60_000;

/** The query options of Gates, and how often the inbox reads them again. */
export function createGateQueries(orpc: ApiQueryUtils) {
	return {
		/** Every gates query. Invalidate it after a Gate is answered. */
		all: () => orpc.gates.key(),
		/**
		 * The open Gates of every Space the person is in, oldest first, each
		 * with its Space and whether they may answer it: the Needs-you inbox.
		 * It does not change with the active Space. The notifications stream
		 * invalidates it; it also reads again once a minute, also while the app
		 * is in the background, for when the stream is down. Refetches when the
		 * window gets focus. A failed read does not toast; the inbox shows the
		 * error itself.
		 */
		open: () => ({
			...orpc.gates.list.queryOptions(),
			refetchInterval: FALLBACK_POLL_MS,
			refetchIntervalInBackground: true,
			refetchOnWindowFocus: "always" as const,
			meta: { quietErrors: true },
		}),
	};
}

/**
 * The mutation options of Gates. `resolve` answers a Gate in any of the
 * person's Spaces, bound to its `runId` and `stepId`; the active Space stays.
 */
export function createGateMutations(orpc: ApiQueryUtils) {
	return {
		resolve: orpc.gates.resolve.mutationOptions,
	};
}
