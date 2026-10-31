import { createFlowQueries, createRunQueries } from "@nightshift/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useHostQueries } from "@/features/host";

/** How many Gates and runs a section of a project shows. "See all" opens the rest. */
export const SHOWN = 5;

/**
 * Starts to read what a project screen shows and the list does not hold:
 * its newest runs and its flows. For a row, when a finger touches it.
 */
export function useProjectPrefetch(): (projectId: string) => void {
	const queryClient = useQueryClient();
	const runQueries = useHostQueries(createRunQueries);
	const flowQueries = useHostQueries(createFlowQueries);
	return useCallback(
		(projectId: string) => {
			void queryClient.prefetchQuery(runQueries.ofProject(projectId, SHOWN));
			void queryClient.prefetchQuery(flowQueries.list(projectId));
		},
		[queryClient, runQueries, flowQueries],
	);
}
