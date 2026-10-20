import { useQuery } from "@tanstack/react-query";

import { gateQueries } from "./queries";

/**
 * The open Gates over all runs, oldest first: the Needs-you inbox. Polls, and
 * refetches when the window gets focus. A failed poll does not toast; the
 * inbox shows the error itself.
 */
export function useOpenGates() {
	return useQuery(gateQueries.open());
}
