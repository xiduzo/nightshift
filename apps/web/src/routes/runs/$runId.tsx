import { createFileRoute } from "@tanstack/react-router";

import { preloadRunPage, RunPage } from "@/features/runs";

export const Route = createFileRoute("/runs/$runId")({
	// The transcript streams from the browser; nothing to render on the server.
	ssr: false,
	/** `step`: opens the run at that step, with its console open. */
	validateSearch: (search: Record<string, unknown>): { step?: string } =>
		typeof search.step === "string" ? { step: search.step } : {},
	loader: ({ context, params }) =>
		preloadRunPage(context.queryClient, params.runId),
	component: RunRoute,
});

function RunRoute() {
	const { runId } = Route.useParams();
	const { step } = Route.useSearch();
	return <RunPage runId={runId} stepId={step} />;
}
