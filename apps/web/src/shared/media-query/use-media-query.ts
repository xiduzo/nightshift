import { useSyncExternalStore } from "react";

/**
 * Whether the window matches a media query (`"(min-width: 1024px)"`),
 * kept up to date. `serverMatches` is the answer while the page renders
 * without a window.
 */
export function useMediaQuery(query: string, serverMatches = false): boolean {
	return useSyncExternalStore(
		(onChange) => {
			const list = window.matchMedia(query);
			list.addEventListener("change", onChange);
			return () => list.removeEventListener("change", onChange);
		},
		() => window.matchMedia(query).matches,
		() => serverMatches,
	);
}
