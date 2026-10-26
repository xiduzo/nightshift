import { createFileRoute } from "@tanstack/react-router";

import { FlowPage, preloadFlowPage } from "@/features/flows";

export const Route = createFileRoute("/projects/$projectId/flows/$name")({
	// The canvas measures nodes in the browser; nothing to render on the server.
	ssr: false,
	/** `chat`: opens the chat panel ("open"), or a chat about a run ("run:<id>"). */
	validateSearch: (search: Record<string, unknown>): { chat?: string } =>
		typeof search.chat === "string" ? { chat: search.chat } : {},
	loader: ({ context, params }) =>
		preloadFlowPage(context.queryClient, params.projectId, params.name),
	component: FlowEditorRoute,
});

function FlowEditorRoute() {
	const { projectId, name } = Route.useParams();
	const { chat } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<FlowPage
			projectId={projectId}
			name={name}
			chat={chat}
			onChatLinkUsed={() => void navigate({ search: {}, replace: true })}
		/>
	);
}
