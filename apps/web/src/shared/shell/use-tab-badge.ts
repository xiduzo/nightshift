import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

import { useOpenGates } from "@/features/gates";

const COUNT_PREFIX = /^\(\d+\+?\) /;
const ICON = "/favicon.svg";
const ICON_WAITING = "/favicon-waiting.svg";

/**
 * Marks the browser tab while Gates wait for you: the count goes in front of
 * the title ("(2) Night Shift") and the icon gets a dot. It reads the open
 * Gates of the inbox, so it shares their cache: the notifications stream
 * reads them again when a Gate opens or closes. It marks the tab again after
 * each page change, in case the page set its own title. Mount it once.
 */
export function useTabBadge() {
	const gates = useOpenGates();
	const open = gates.data?.length ?? 0;
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	// biome-ignore lint/correctness/useExhaustiveDependencies: a page change can reset the title.
	useEffect(() => {
		const base = document.title.replace(COUNT_PREFIX, "");
		document.title = open > 0 ? `(${open > 99 ? "99+" : open}) ${base}` : base;
		const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
		icon?.setAttribute("href", open > 0 ? ICON_WAITING : ICON);
	}, [open, pathname]);

	useEffect(
		() => () => {
			document.title = document.title.replace(COUNT_PREFIX, "");
			document
				.querySelector<HTMLLinkElement>('link[rel="icon"]')
				?.setAttribute("href", ICON);
		},
		[],
	);
}

/** Mounts the tab badge. Renders nothing. */
export function TabBadge() {
	useTabBadge();
	return null;
}
