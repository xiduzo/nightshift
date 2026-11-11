import { createFileRoute } from "@tanstack/react-router";

import { FeedbackPage } from "@/features/feedback";

export const Route = createFileRoute("/_app/feedback")({
	component: FeedbackPage,
});
