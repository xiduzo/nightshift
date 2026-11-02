import { createFileRoute } from "@tanstack/react-router";

import { MixPage } from "@/features/mix";

export const Route = createFileRoute("/_app/mix")({
	component: MixPage,
});
