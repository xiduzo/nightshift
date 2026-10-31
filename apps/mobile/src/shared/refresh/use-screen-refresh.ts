import { useCallback, useEffect, useRef } from "react";

/** A query's own `refetch`: what a screen reads again. */
type Refetch = () => Promise<unknown>;

/**
 * The pull-down of a screen (`Screen`'s `onRefresh`): reads its queries
 * again, and settles when every query has answered, also when one fails.
 * Coming back to a screen reads nothing by itself: the live cache marks
 * what changed, and a query that went stale reads again when its screen
 * gets focus (`useWhileFocused`).
 */
export function useScreenRefresh(
	refetches: readonly Refetch[],
): () => Promise<unknown> {
	const latest = useRef(refetches);
	useEffect(() => {
		latest.current = refetches;
	});

	return useCallback(
		() => Promise.allSettled(latest.current.map((refetch) => refetch())),
		[],
	);
}
