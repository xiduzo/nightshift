import type { QueryClient } from "@tanstack/react-query";

import { runQueries } from "@/features/runs";
import { preloadQuery } from "@/shared/api";

import { dashboardQueries } from "./queries";

/** The data of the home page: the numbers of every project, and what runs now. */
export function preloadHomePage(queryClient: QueryClient) {
	preloadQuery(queryClient, dashboardQueries.summary());
	preloadQuery(queryClient, runQueries.open());
}

/** The data of a project's dashboard: its numbers. */
export function preloadProjectDashboardPage(
	queryClient: QueryClient,
	projectId: string,
) {
	preloadQuery(queryClient, dashboardQueries.summary({ projectId }));
}
