import { createFileRoute } from "@tanstack/react-router";

import { NightsPage } from "@/features/nights";

export const Route = createFileRoute("/_app/nights")({
	component: NightsPage,
});
