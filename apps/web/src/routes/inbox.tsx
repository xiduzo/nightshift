import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { InboxPage, type InboxTab, preloadInboxPage } from "@/features/gates";

type InboxSearch = { tab?: "digest"; gate?: string; digest?: string };

export const Route = createFileRoute("/inbox")({
	// Polls from the browser; nothing to render on the server.
	ssr: false,
	/**
	 * `tab`: `digest` for the daily digests, else the Gates that wait.
	 * `gate`: the step id of the Gate the pane shows. `digest`: the key of
	 * the digest the pane shows.
	 */
	validateSearch: (search: Record<string, unknown>): InboxSearch => ({
		...(search.tab === "digest" ? { tab: "digest" as const } : {}),
		...(typeof search.gate === "string" ? { gate: search.gate } : {}),
		...(typeof search.digest === "string" ? { digest: search.digest } : {}),
	}),
	loader: ({ context }) => preloadInboxPage(context.queryClient),
	component: InboxRoute,
});

function InboxRoute() {
	const { tab, gate, digest } = Route.useSearch();
	const navigate = Route.useNavigate();
	const onSelect = useCallback(
		(next: { tab: InboxTab; gate?: string; digest?: string }) => {
			void navigate({
				search: (prev) => {
					// Each tab keeps what it showed when you come back to it.
					const gateId = next.gate ?? prev.gate;
					const digestKey = next.digest ?? prev.digest;
					return {
						...(next.tab === "digest" ? { tab: "digest" as const } : {}),
						...(gateId ? { gate: gateId } : {}),
						...(digestKey ? { digest: digestKey } : {}),
					};
				},
				replace: true,
			});
		},
		[navigate],
	);
	return (
		<InboxPage
			tab={tab ?? "waiting"}
			gateId={gate}
			digestKey={digest}
			onSelect={onSelect}
		/>
	);
}
