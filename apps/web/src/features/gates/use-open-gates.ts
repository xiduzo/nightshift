import { useQuery } from "@tanstack/react-query";

import { gateQueries } from "./queries";

/**
 * The open Gates of every Space you are in, oldest first: the Needs-you
 * inbox. Each has its Space and whether you may answer it. The
 * notifications stream reads it again when a Gate opens or closes, and it
 * refetches when the window gets focus. A failed read does not toast; the
 * inbox shows the error itself.
 */
export function useOpenGates() {
	return useQuery(gateQueries.open());
}
