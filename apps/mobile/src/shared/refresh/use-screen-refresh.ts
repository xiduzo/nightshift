import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";

/** A query's own `refetch`: what a screen reads again. */
type Refetch = () => Promise<unknown>;

/**
 * Reads a screen's queries again when the person comes back to it. The
 * first focus does nothing: the queries just loaded. Returns the same
 * reading for pull-down (`Screen`'s `onRefresh`), which settles when every
 * query has answered, also when one fails.
 */
export function useScreenRefresh(
	refetches: readonly Refetch[],
): () => Promise<unknown> {
	const latest = useRef(refetches);
	useEffect(() => {
		latest.current = refetches;
	});
	const seen = useRef(false);

	const readAgain = useCallback(
		() => Promise.allSettled(latest.current.map((refetch) => refetch())),
		[],
	);

	useFocusEffect(
		useCallback(() => {
			if (seen.current) void readAgain();
			seen.current = true;
		}, [readAgain]),
	);

	return readAgain;
}
