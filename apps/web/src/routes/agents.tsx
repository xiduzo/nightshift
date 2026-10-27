import { createFileRoute } from "@tanstack/react-router";

import { AgentsPage } from "@/features/agents";

export const Route = createFileRoute("/agents")({
	// The checks run CLIs on the daemon; nothing to render on the server.
	ssr: false,
	/** `item`: what the detail pane shows, for example `harness:claude-code`. */
	validateSearch: (search: Record<string, unknown>): { item?: string } =>
		typeof search.item === "string" ? { item: search.item } : {},
	component: AgentsRoute,
});

function AgentsRoute() {
	const { item } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<AgentsPage
			item={item}
			onSelect={(next) =>
				void navigate({ search: next ? { item: next } : {}, replace: true })
			}
		/>
	);
}
