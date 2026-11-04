import {
	createKnowledgeQueries,
	type SettleFailure,
	stillWaiting,
	useSettleLearnings,
	type WaitingLearning,
} from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { useHostQueries, useSignedIn } from "@/features/host";

/**
 * The learnings of every project that wait for you, with Keep and Delete.
 * A learning you keep or delete leaves the list at once, and `failure` says
 * why when it comes back. Undefined while they load, when they did not load,
 * or on an older Host, which does not list them. A screen passes
 * `useWhileFocused().subscribed`.
 */
export function useLearningsToCheck(subscribed = true) {
	const knowledge = useHostQueries(createKnowledgeQueries);
	const list = useQuery({ ...knowledge.learnings(), subscribed });
	const [failure, setFailure] = useState<SettleFailure | null>(null);
	const { settled, settle } = useSettleLearnings(useSignedIn().host.orpc, {
		onFailed: setFailure,
	});
	const onKeep = useCallback(
		(learning: WaitingLearning) => {
			setFailure(null);
			settle(learning, "keep");
		},
		[settle],
	);
	const onDelete = useCallback(
		(learning: WaitingLearning) => {
			setFailure(null);
			settle(learning, "delete");
		},
		[settle],
	);
	const learnings: WaitingLearning[] | undefined = useMemo(
		() => (list.data ? stillWaiting(list.data, settled) : undefined),
		[list.data, settled],
	);
	return { learnings, refetch: list.refetch, failure, onKeep, onDelete };
}
