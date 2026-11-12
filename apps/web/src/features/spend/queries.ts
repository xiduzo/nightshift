/**
 * The query options of the Spend page: its numbers, computed by Night
 * Shift (`@nightshift/client`, on this app's client).
 */

import { createDashboardQueries } from "@nightshift/client";

import { orpc } from "@/shared/api";

/** What the runs of the Space cost, for every range of the page. */
export const spendQuery = () => createDashboardQueries(orpc).spend();
