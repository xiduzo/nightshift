import { createFileRoute } from "@tanstack/react-router";

import { RunPage } from "@/features/runs";

export const Route = createFileRoute("/runs/$runId")({
	// The transcript streams from the browser; nothing to render on the server.
	ssr: false,
	component: RunRoute,
});

function RunRoute() {
	const { runId } = Route.useParams();
	return <RunPage runId={runId} />;
}
