import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { runQueries } from "../queries";

/**
 * One project's runs, `pageSize` at a time: the run that last did
 * something comes first. The live cache
 * reads the loaded pages again when a run starts, sleeps, stops or ends,
 * or reaches a Gate.
 */
export function useProjectRuns(projectId: string, pageSize: number) {
	const query = useInfiniteQuery(
		runQueries.pages({ projectId, order: "activity" }, pageSize),
	);
	const runs = useMemo(() => query.data?.pages.flat(), [query.data]);
	return { ...query, runs };
}
