import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

/** How often the inbox and its badge look for new open Gates. */
const POLL_MS = 5000;

/**
 * The open Gates over all runs, oldest first: the Needs-you inbox. Polls, and
 * refetches when the window gets focus. A failed poll does not toast; the
 * inbox shows the error itself.
 */
export function useOpenGates() {
	return useQuery({
		...orpc.gates.list.queryOptions(),
		refetchInterval: POLL_MS,
		refetchOnWindowFocus: "always",
		meta: { quietErrors: true },
	});
}
