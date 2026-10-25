import {
	createApiClient,
	createQueryUtils,
	createQueryClient as createSharedQueryClient,
} from "@nightshift/client";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { SERVER_URL } from "./server-url";

/**
 * What the app does with an error of a query or a mutation before the
 * toast: true when it is handled, so no toast shows. The access feature
 * gives it (`sendToAccess`), because `shared/api` imports no feature.
 */
export type ErrorHandler = (client: QueryClient, error: unknown) => boolean;

/**
 * The query client of this app: the shared rules of `@nightshift/client`,
 * the access redirect, and a toast for a query error the person should see.
 */
export function createQueryClient(handle: ErrorHandler): QueryClient {
	return createSharedQueryClient({
		handle,
		show: (error, query) => {
			// Queries that fail for one reason (a run that is gone) show one toast.
			toast.error(`Error: ${error.message}`, {
				id: `query-error:${error.message}`,
				action: {
					label: "retry",
					onClick: () => {
						query.invalidate();
					},
				},
			});
		},
	});
}

/** The browser sends the session cookie with every call. */
export const client = createApiClient({
	baseUrl: SERVER_URL,
	fetch: (request, init) => fetch(request, { ...init, credentials: "include" }),
});

export const orpc = createQueryUtils(client);
