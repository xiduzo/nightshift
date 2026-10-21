import { createApiClient, createQueryUtils } from "@nightshift/client";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { SERVER_URL } from "./server-url";

/**
 * What the app does with an error of a query or a mutation before the
 * toast: true when it is handled, so no toast shows. The access feature
 * gives it (`sendToAccess`), because `shared/api` imports no feature.
 */
export type ErrorHandler = (client: QueryClient, error: unknown) => boolean;

export function createQueryClient(handle: ErrorHandler) {
	const toAccess = (error: unknown) => handle(client, error);
	const client = new QueryClient({
		mutationCache: new MutationCache({
			onError: (error) => {
				toAccess(error);
			},
		}),
		queryCache: new QueryCache({
			onError: (error, query) => {
				if (toAccess(error)) return;
				// Polling queries show their own error instead of a toast per poll.
				if (query.meta?.quietErrors) return;
				// A failed background refetch keeps the data it has; no toast either.
				if (query.meta?.quietRefetchErrors && query.state.data !== undefined) {
					return;
				}
				toast.error(`Error: ${error.message}`, {
					action: {
						label: "retry",
						onClick: () => {
							query.invalidate();
						},
					},
				});
			},
		}),
		defaultOptions: { queries: { staleTime: 60 * 1000 } },
	});
	return client;
}

/** The browser sends the session cookie with every call. */
export const client = createApiClient({
	baseUrl: SERVER_URL,
	fetch: (request, init) => fetch(request, { ...init, credentials: "include" }),
});

export const orpc = createQueryUtils(client);
