import { createFileRoute } from "@tanstack/react-router";

import { FlowPage, preloadFlowPage } from "@/features/flows";

export const Route = createFileRoute("/projects/$projectId/flows/$name")({
	// The canvas measures nodes in the browser; nothing to render on the server.
	ssr: false,
	loader: ({ context, params }) =>
		preloadFlowPage(context.queryClient, params.projectId, params.name),
	component: FlowEditorRoute,
});

function FlowEditorRoute() {
	const { projectId, name } = Route.useParams();
	return <FlowPage projectId={projectId} name={name} />;
}
