import { createFileRoute } from "@tanstack/react-router";

import { SpaceSecretsPage } from "@/features/agents";

export const Route = createFileRoute("/space-secrets")({
	// The secrets live on the daemon and the Host; nothing to render on the server.
	ssr: false,
	component: SpaceSecretsPage,
});
