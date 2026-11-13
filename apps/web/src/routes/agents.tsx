import { createFileRoute, redirect } from "@tanstack/react-router";

import { settingsSearchOfAgents } from "@/features/settings";

/** The Agents page became pages of Settings. A link to an item opens the page that lists it. */
export const Route = createFileRoute("/agents")({
	/** `item`: what opens in detail, for example `harness:claude-code`. */
	validateSearch: (search: Record<string, unknown>): { item?: string } =>
		typeof search.item === "string" ? { item: search.item } : {},
	beforeLoad: ({ search }) => {
		throw redirect({
			to: "/settings",
			search: settingsSearchOfAgents(search.item),
			replace: true,
		});
	},
});
