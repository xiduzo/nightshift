import type { ApiQueryUtils } from "../api";

/** How often the inbox and its badge look for new open Gates. */
const POLL_MS = 5000;

/** The query options of Gates, and how often the inbox polls. */
export function createGateQueries(orpc: ApiQueryUtils) {
	return {
		/** Every gates query. Invalidate it after a Gate is answered. */
		all: () => orpc.gates.key(),
		/**
		 * The open Gates of every Space the person is in, oldest first, each
		 * with its Space and whether they may answer it: the Needs-you inbox.
		 * It does not change with the active Space. Polls,
		 * also while the app is in the background, so the badge and the
		 * notifications stay current. Refetches when the window gets focus. A
		 * failed poll does not toast; the inbox shows the error itself.
		 */
		open: () => ({
			...orpc.gates.list.queryOptions(),
			refetchInterval: POLL_MS,
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
