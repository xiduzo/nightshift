import { createKnowledgeQueries } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";

import { useHostQueries } from "@/features/host";
import { useWhileFocused } from "@/shared/refresh";

function countOf(list: readonly unknown[]): number {
	return list.length;
}

/**
 * How many learnings wait: of one project, or of every project. Undefined
 * while they load, when they did not load, or on a Host of an older
 * version, which does not list them. The screen
 * renders again only when the count changes.
 */
export function useWaitingLearnings(projectId?: string): number | undefined {
	const knowledge = useHostQueries(createKnowledgeQueries);
	return useQuery({
		...knowledge.learnings(projectId),
		select: countOf,
		...useWhileFocused(),
	}).data;
}
