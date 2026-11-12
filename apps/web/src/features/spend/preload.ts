import type { QueryClient } from "@tanstack/react-query";

import { preloadQuery } from "@/shared/api";

import { spendQuery } from "./queries";

/** The data of the Spend page. */
export function preloadSpendPage(queryClient: QueryClient) {
	preloadQuery(queryClient, spendQuery());
}
