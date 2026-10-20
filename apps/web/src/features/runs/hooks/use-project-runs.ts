import { useQuery } from "@tanstack/react-query";

import { runQueries } from "../queries";

/**
 * One project's runs. Polls while a run is on its way, so one that reaches a
 * Gate shows as waiting.
 */
export function useProjectRuns(projectId: string) {
	return useQuery(runQueries.ofProjectLive(projectId));
}
