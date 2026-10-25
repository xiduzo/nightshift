import { useQuery } from "@tanstack/react-query";

import { runQueries } from "../queries";

/**
 * One project's runs. The live cache reads them again when a run starts,
 * sleeps, stops or ends, or reaches a Gate.
 */
export function useProjectRuns(projectId: string) {
	return useQuery(runQueries.ofProject(projectId));
}
