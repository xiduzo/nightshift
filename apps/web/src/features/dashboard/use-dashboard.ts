import { matchQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { runQueries } from "@/features/runs";

import { dashboardQueries } from "./queries";

/**
 * The dashboard's numbers. They come from the runs, so whatever makes the
 * runs read again (a run started, stopped, a Gate answered) makes them
 * read again too.
 */
export function useDashboard(
	input?: Parameters<typeof dashboardQueries.summary>[0],
) {
	const queryClient = useQueryClient();
	useEffect(
		() =>
			queryClient.getQueryCache().subscribe((event) => {
				if (
					event.type === "updated" &&
					event.action.type === "invalidate" &&
					matchQuery({ queryKey: runQueries.all() }, event.query)
				) {
					void queryClient.invalidateQueries({
						queryKey: dashboardQueries.all(),
					});
				}
			}),
		[queryClient],
	);
	return useQuery(dashboardQueries.summary(input));
}
