import { useMemo } from "react";

import { useInbox } from "@/features/inbox";
import { useStoppedRuns } from "@/features/runs";
import { type NeedsItem, needsItems } from "./queue";

/**
 * Everything that waits for you: the Gates you may answer and the runs
 * that stopped in the last day, in one order
 * (`needsItems`). `loading` while no part has loaded. A screen passes
 * `useWhileFocused().subscribed`. The tab bar stays subscribed.
 */
export function useNeedsYou(subscribed = true) {
	const gates = useInbox(subscribed);
	const stopped = useStoppedRuns(subscribed);
	const items: NeedsItem[] = useMemo(
		() =>
			needsItems({
				gates: gates.data,
				runs: stopped.runs,
			}),
		[gates.data, stopped.runs],
	);
	const refetch = () => Promise.all([gates.refetch(), stopped.refetch()]);
	return {
		items,
		/** The Gates did not load: the queue may miss them. */
		gatesError: gates.error,
		runsError: stopped.error,
		loading: gates.data === undefined && !gates.error,
		refetch,
	};
}

/** How many things wait for you: the badge of the Needs you tab. */
export function useNeedsCount(): number {
	return useNeedsYou(true).items.length;
}
