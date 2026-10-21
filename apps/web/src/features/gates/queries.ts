/**
 * The query and mutation options of Gates, and how often the inbox polls.
 */

import { orpc } from "@/shared/api";

/** How often the inbox and its badge look for new open Gates. */
const POLL_MS = 5000;

export const gateQueries = {
	/** Every gates query. Invalidate it after a Gate is answered. */
	all: () => orpc.gates.key(),
	/**
	 * The open Gates over all runs, oldest first: the Needs-you inbox. Polls,
	 * also while the tab is in the background, so the tab badge and the
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

export const gateMutations = {
	resolve: orpc.gates.resolve.mutationOptions,
};
