import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { InboxPage, preloadInboxPage } from "@/features/gates";

type InboxSearch = { gate?: string };

export const Route = createFileRoute("/inbox")({
	// Polls from the browser; nothing to render on the server.
	ssr: false,
	/** `gate`: the step id of the Gate the pane shows. */
	validateSearch: (search: Record<string, unknown>): InboxSearch =>
		typeof search.gate === "string" ? { gate: search.gate } : {},
	loader: ({ context }) => preloadInboxPage(context.queryClient),
	component: InboxRoute,
});

function InboxRoute() {
	const { gate } = Route.useSearch();
	const navigate = Route.useNavigate();
	const onSelect = useCallback(
		(next: string) => {
			void navigate({ search: { gate: next }, replace: true });
		},
		[navigate],
	);
	return <InboxPage gateId={gate} onSelect={onSelect} />;
}
