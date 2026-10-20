import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/api";

/**
 * One project's runs. Polls while a run is on its way, so one that reaches a
 * Gate shows as waiting.
 */
export function useProjectRuns(projectId: string) {
	return useQuery({
		...orpc.runs.list.queryOptions({ input: { projectId } }),
		refetchInterval: (query) =>
			query.state.data?.some(
				(run) =>
					run.status === "running" ||
					run.status === "waiting" ||
					run.status === "sleeping",
			)
				? 5000
				: false,
		meta: { quietRefetchErrors: true },
	});
}
