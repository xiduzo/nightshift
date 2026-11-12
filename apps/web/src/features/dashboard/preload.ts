import type { QueryClient } from "@tanstack/react-query";

import { preloadQuery } from "@/shared/api";

import { dashboardQueries } from "./queries";

/** The data of the home page: the numbers of every project. */
export function preloadHomePage(queryClient: QueryClient) {
	preloadQuery(queryClient, dashboardQueries.summary());
}

/** The data of a project's dashboard: its numbers. */
export function preloadProjectDashboardPage(
	queryClient: QueryClient,
	projectId: string,
) {
	preloadQuery(queryClient, dashboardQueries.summary({ projectId }));
}
