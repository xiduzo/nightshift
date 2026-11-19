import type { QueryClient } from "@tanstack/react-query";

import { preloadQuery } from "@/shared/api";
import { gateQueries, runQueries } from "./queries";

/**
 * The data of the inbox besides the open Gates, which the sidebar loads:
 * the runs that are not done and the answered Gates.
 */
export function preloadInboxPage(queryClient: QueryClient) {
	preloadQuery(queryClient, runQueries.sleeping());
	preloadQuery(queryClient, gateQueries.answered());
}
