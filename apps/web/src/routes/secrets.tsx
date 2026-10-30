import { createFileRoute } from "@tanstack/react-router";

import { SecretsPage } from "@/features/agents";

export const Route = createFileRoute("/secrets")({
	// The secrets live on the daemon; nothing to render on the server.
	ssr: false,
	component: SecretsPage,
});
