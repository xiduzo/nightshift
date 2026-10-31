import { useMemo } from "react";

import { useInbox } from "@/features/inbox";
import { type Learning, useLearningsToCheck } from "@/features/learnings";
import { useStoppedRuns } from "@/features/runs";
import { type NeedsItem, needsItems } from "./queue";

/**
 * Everything that waits for you: the Gates you may answer, the runs that
 * stopped in the last day and the learnings to check, in one order
 * (`needsItems`). `loading` while no part has loaded. A screen passes
 * `useWhileFocused().subscribed`. The tab bar stays subscribed.
 */
export function useNeedsYou(subscribed = true) {
	const gates = useInbox(subscribed);
	const stopped = useStoppedRuns(subscribed);
	const learnings = useLearningsToCheck(subscribed);
	const items: NeedsItem<Learning>[] = useMemo(
		() =>
			needsItems({
				gates: gates.data,
				runs: stopped.runs,
				learnings: learnings.learnings,
			}),
		[gates.data, stopped.runs, learnings.learnings],
	);
	const refetch = () =>
		Promise.all([gates.refetch(), stopped.refetch(), learnings.refetch()]);
	return {
		items,
		/** The Gates did not load: the queue may miss them. */
		gatesError: gates.error,
		runsError: stopped.error,
		loading: gates.data === undefined && !gates.error,
		learnings,
		refetch,
	};
}

/** How many things wait for you: the badge of the Needs you tab. */
export function useNeedsCount(): number {
	return useNeedsYou(true).items.length;
}
