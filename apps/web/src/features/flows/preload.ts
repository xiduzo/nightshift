import type { QueryClient } from "@tanstack/react-query";

import { preloadQuery } from "@/shared/api";

import { flowQueries } from "./queries";

/**
 * The data of the flow editor: the flow file, and the project's other
 * flows its Subflow nodes call. It does not toast a failure, such as a
 * name that is not valid: the editor shows it.
 */
export function preloadFlowPage(
	queryClient: QueryClient,
	projectId: string,
	name: string,
) {
	preloadQuery(queryClient, {
		...flowQueries.get(projectId, name),
		meta: { quietErrors: true },
	});
	preloadQuery(queryClient, {
		...flowQueries.map(projectId),
		meta: { quietErrors: true },
	});
}
