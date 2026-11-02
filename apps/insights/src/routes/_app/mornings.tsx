import { createFileRoute } from "@tanstack/react-router";

import { MorningsPage } from "@/features/mornings";

export const Route = createFileRoute("/_app/mornings")({
	component: MorningsPage,
});
