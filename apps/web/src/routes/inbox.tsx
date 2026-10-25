import { createFileRoute } from "@tanstack/react-router";

import { InboxPage, preloadInboxPage } from "@/features/gates";

export const Route = createFileRoute("/inbox")({
	// Polls from the browser; nothing to render on the server.
	ssr: false,
	/** `gate`: the step id of the Gate the pane shows. */
	validateSearch: (search: Record<string, unknown>): { gate?: string } =>
		typeof search.gate === "string" ? { gate: search.gate } : {},
	loader: ({ context }) => preloadInboxPage(context.queryClient),
	component: InboxRoute,
});

function InboxRoute() {
	const { gate } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<InboxPage
			gateId={gate}
			onSelect={(next) =>
				void navigate({ search: { gate: next }, replace: true })
			}
		/>
	);
}
