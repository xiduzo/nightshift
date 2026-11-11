import { createFileRoute } from "@tanstack/react-router";

import { FunnelPage } from "@/features/funnel";

export const Route = createFileRoute("/_app/funnel")({
	component: FunnelPage,
});
