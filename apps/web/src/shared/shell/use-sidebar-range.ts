import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PAGE_RANGES } from "@/features/dashboard";

type Range = (typeof PAGE_RANGES)[number];

/** The pages with a range row: Home and a project's page. */
const RANGED_ROUTES = new Set<string>(["/", "/projects/$projectId/"]);

/**
 * The range of days of the project donuts in the sidebar. It follows the
 * range row of Home and of a project's page, and keeps the last one on
 * the other pages. 7 days until you choose one.
 */
export function useSidebarRange(): Range {
	const onPage = useRouterState({
		select: (state) => {
			const match = state.matches.find((m) => RANGED_ROUTES.has(m.routeId));
			if (!match) return undefined;
			const { range } = match.search as { range?: Range };
			return PAGE_RANGES.find((days) => days === range) ?? 7;
		},
	});
	const [kept, setKept] = useState<Range>(7);
	useEffect(() => {
		if (onPage !== undefined) setKept(onPage);
	}, [onPage]);
	return onPage ?? kept;
}
