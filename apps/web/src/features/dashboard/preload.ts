import type { QueryClient } from "@tanstack/react-query";

import { runQueries } from "@/features/runs";
import { preloadQuery } from "@/shared/api";

import { OVERVIEW_ROWS } from "./overview";
import { dashboardQueries } from "./queries";

/** The data of the home page: the numbers of every project, and the runs. */
export function preloadHomePage(queryClient: QueryClient) {
	preloadQuery(queryClient, dashboardQueries.summary());
	preloadQuery(queryClient, runQueries.latest(OVERVIEW_ROWS));
}

/** The data of a project's dashboard: its numbers. */
export function preloadProjectDashboardPage(
	queryClient: QueryClient,
	projectId: string,
) {
	preloadQuery(queryClient, dashboardQueries.summary({ projectId }));
}
