import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import type { ApiQueryUtils } from "../api";
import { createRunQueries } from "./queries";

/**
 * Starts to read a run before its screen opens: when a finger touches its
 * row. It reads only what the cache does not hold yet, and never throws:
 * the screen shows its own loading and errors.
 */
export function useRunPrefetch(orpc: ApiQueryUtils): (runId: string) => void {
	const queryClient = useQueryClient();
	return useCallback(
		(runId: string) => {
			void queryClient.prefetchQuery(createRunQueries(orpc).get(runId));
		},
		[queryClient, orpc],
	);
}
