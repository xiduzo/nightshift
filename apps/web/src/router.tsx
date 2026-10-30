import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { sendToAccess } from "@/features/access";
import { createQueryClient, orpc } from "@/shared/api";
import { Loader } from "@/shared/page";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
	const queryClient = createQueryClient(sendToAccess);

	const router = createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		// Pointing at a link loads its page and starts its data (each route's loader).
		// TanStack Query decides when data is stale, so the router keeps none.
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		context: { orpc, queryClient },
		defaultPendingComponent: () => <Loader />,
		defaultNotFoundComponent: () => <div>Page not found</div>,
	});

	setupRouterSsrQueryIntegration({
		router,
		queryClient,
	});

	return router;
};

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
