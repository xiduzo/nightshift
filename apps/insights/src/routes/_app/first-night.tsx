import { createFileRoute } from "@tanstack/react-router";

import { FirstNightPage } from "@/features/first-night";

export const Route = createFileRoute("/_app/first-night")({
	component: FirstNightPage,
});
