import type { QueryClient } from "@tanstack/react-query";

import { runQueries } from "@/features/runs/queries";
import { preloadQuery } from "@/shared/api";

/** The data of the inbox besides the open Gates, which the sidebar loads: the runs that are not done. */
export function preloadInboxPage(queryClient: QueryClient) {
	preloadQuery(queryClient, runQueries.everyRunForInbox());
}
