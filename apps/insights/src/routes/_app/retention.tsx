import { createFileRoute } from "@tanstack/react-router";

import { RetentionPage } from "@/features/retention";

export const Route = createFileRoute("/_app/retention")({
	component: RetentionPage,
});
