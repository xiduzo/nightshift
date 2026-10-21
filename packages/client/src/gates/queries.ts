import type { ApiQueryUtils } from "../api";

/** How often the inbox and its badge look for new open Gates. */
const POLL_MS = 5000;

/** The query options of Gates, and how often the inbox polls. */
export function createGateQueries(orpc: ApiQueryUtils) {
	return {
		/** Every gates query. Invalidate it after a Gate is answered. */
		all: () => orpc.gates.key(),
		/**
		 * The open Gates over all runs, oldest first: the Needs-you inbox. Polls,
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

/** The mutation options of Gates. */
export function createGateMutations(orpc: ApiQueryUtils) {
	return {
		resolve: orpc.gates.resolve.mutationOptions,
	};
}
