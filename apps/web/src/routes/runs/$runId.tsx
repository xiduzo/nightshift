import { createFileRoute } from "@tanstack/react-router";

import { preloadRunPage, RunPage } from "@/features/runs";

export const Route = createFileRoute("/runs/$runId")({
	// The transcript streams from the browser; nothing to render on the server.
	ssr: false,
	loader: ({ context, params }) =>
		preloadRunPage(context.queryClient, params.runId),
	component: RunRoute,
});

function RunRoute() {
	const { runId } = Route.useParams();
	return <RunPage runId={runId} />;
}
