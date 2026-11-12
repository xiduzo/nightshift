import { createFileRoute } from "@tanstack/react-router";

import { LaddersPage } from "@/features/ladders";

export const Route = createFileRoute("/_app/ladders")({
	component: LaddersPage,
});
