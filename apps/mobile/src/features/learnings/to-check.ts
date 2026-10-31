import { createKnowledgeQueries } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useHostQueries } from "@/features/host";
import { useSettleLearnings } from "./use-settle";
import { type Learning, stillWaiting } from "./waiting";

/**
 * The learnings of every project that wait for you, with Keep and Delete.
 * A learning you keep or delete leaves the list at once. Undefined while
 * they load, when they did not load, or on an older Host, which does not
 * list them. A screen passes `useWhileFocused().subscribed`.
 */
export function useLearningsToCheck(subscribed = true) {
	const knowledge = useHostQueries(createKnowledgeQueries);
	const list = useQuery({ ...knowledge.learnings(), subscribed });
	const settle = useSettleLearnings();
	const { settled } = settle;
	const learnings: Learning[] | undefined = useMemo(
		() => (list.data ? stillWaiting(list.data, settled) : undefined),
		[list.data, settled],
	);
	return { learnings, refetch: list.refetch, ...settle };
}
