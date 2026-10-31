import { useIsFocused } from "expo-router";

/**
 * The query option of a screen: it follows the cache only while it has
 * focus. A tab, or a screen under another one, stays mounted but does not
 * render on each change. When it gets focus again, it shows what the cache
 * has, and a query that went stale meanwhile reads again by itself.
 *
 * `useQuery({ ...runs.get(runId), ...useWhileFocused() })`
 */
export function useWhileFocused(): { subscribed: boolean } {
	return { subscribed: useIsFocused() };
}
