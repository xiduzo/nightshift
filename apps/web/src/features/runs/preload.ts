import type { QueryClient } from "@tanstack/react-query";

import { preloadQuery } from "@/shared/api";

import { runQueries } from "./queries";

/** The data of a run's page: the run and the files its agents kept, side by side. */
export function preloadRunPage(queryClient: QueryClient, runId: string) {
	preloadQuery(queryClient, runQueries.get(runId));
	preloadQuery(queryClient, runQueries.artifacts(runId, false));
}
