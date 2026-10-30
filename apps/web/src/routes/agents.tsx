import { createFileRoute } from "@tanstack/react-router";

import { AgentsPage } from "@/features/agents";

export const Route = createFileRoute("/agents")({
	// The checks run CLIs on the daemon; nothing to render on the server.
	ssr: false,
	/** `item`: what the detail pane shows, for example `harness:claude-code`. */
	validateSearch: (
		search: Record<string, unknown>,
	): { item?: string; variant?: string } => ({
		...(typeof search.item === "string" ? { item: search.item } : {}),
		// PROTOTYPE, throw away: which shape of the page.
		...(typeof search.variant === "string" ? { variant: search.variant } : {}),
	}),
	component: AgentsRoute,
});

function AgentsRoute() {
	const { item, variant } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<AgentsPage
			item={item}
			variant={variant}
			onSelect={(next) =>
				void navigate({
					search: (prev) => ({ ...prev, item: next }),
					replace: true,
				})
			}
		/>
	);
}
