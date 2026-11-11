import { createFileRoute } from "@tanstack/react-router";

import { DaysPage } from "@/features/days";

export const Route = createFileRoute("/_app/days")({
	component: DaysPage,
});
