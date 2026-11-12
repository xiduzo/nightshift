import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { InboxPage, type InboxPlace, preloadInboxPage } from "@/features/gates";

type InboxSearch = {
	/** The step id of the open Gate in focus. */
	gate?: string;
	/** `answered` or `sleeping`. Absent: the Gates that wait. */
	view?: "answered" | "sleeping";
	/** The answered Gate the Sheet shows. */
	answered?: string;
};

export const Route = createFileRoute("/inbox")({
	// Polls from the browser; nothing to render on the server.
	ssr: false,
	validateSearch: (search: Record<string, unknown>): InboxSearch => ({
		...(typeof search.gate === "string" ? { gate: search.gate } : {}),
		...(search.view === "answered" || search.view === "sleeping"
			? { view: search.view }
			: {}),
		...(typeof search.answered === "string"
			? { answered: search.answered }
			: {}),
	}),
	loader: ({ context }) => preloadInboxPage(context.queryClient),
	component: InboxRoute,
});

function InboxRoute() {
	const { gate, view, answered } = Route.useSearch();
	const navigate = Route.useNavigate();
	const onPlace = useCallback(
		(next: InboxPlace) => {
			void navigate({
				search: {
					...(next.gate ? { gate: next.gate } : {}),
					...(next.view === "todo" ? {} : { view: next.view }),
					...(next.answered ? { answered: next.answered } : {}),
				},
				replace: true,
			});
		},
		[navigate],
	);
	return (
		<InboxPage
			place={{ view: view ?? "todo", gate, answered }}
			onPlace={onPlace}
		/>
	);
}
