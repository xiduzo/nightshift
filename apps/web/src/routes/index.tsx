import { createFileRoute } from "@tanstack/react-router";

import { HomePage, preloadHomePage } from "@/features/dashboard";

export const Route = createFileRoute("/")({
	loader: ({ context }) => preloadHomePage(context.queryClient),
	component: HomePage,
});
