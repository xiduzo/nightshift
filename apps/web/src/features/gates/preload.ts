import type { QueryClient } from "@tanstack/react-query";

import { notificationQueries } from "@/features/notifications";
import { runQueries } from "@/features/runs/queries";
import { preloadQuery } from "@/shared/api";
import { gateQueries } from "./queries";

/**
 * The data of the inbox besides the open Gates, which the sidebar loads:
 * the runs that are not done, the answered Gates and the digests.
 */
export function preloadInboxPage(queryClient: QueryClient) {
	preloadQuery(queryClient, runQueries.sleeping());
	preloadQuery(queryClient, gateQueries.answered());
	preloadQuery(queryClient, notificationQueries.digests());
}
