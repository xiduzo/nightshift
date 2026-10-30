/**
 * The query options of the dashboard: its numbers, computed by Night Shift
 * (`@nightshift/client`, on this app's client).
 */

import { createDashboardQueries } from "@nightshift/client";

import { orpc } from "@/shared/api";

export const dashboardQueries = createDashboardQueries(orpc);

/** The flows of a project: Flow health shows the computers each one needs. */
export const projectFlowsQuery = (projectId: string) =>
	orpc.flows.list.queryOptions({ input: { projectId } });
