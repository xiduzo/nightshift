import type { AppRouterClient } from "@nightshift/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { SERVER_URL } from "@/lib/server-url";
import { isTwoFactorRequired } from "@/lib/two-factor";

export function createQueryClient() {
	/**
	 * The Host refused the session until it turns two-factor on: read the
	 * account again, and the root sends the person to the setup page.
	 */
	const toSetup = (error: unknown) => {
		if (!isTwoFactorRequired(error)) return false;
		void client.invalidateQueries({ queryKey: orpc.account.status.key() });
		return true;
	};
	const client = new QueryClient({
		mutationCache: new MutationCache({
			onError: (error) => {
				toSetup(error);
			},
		}),
		queryCache: new QueryCache({
			onError: (error, query) => {
				if (toSetup(error)) return;
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

const link = new RPCLink({
	url: `${SERVER_URL}/rpc`,
	fetch(url, options) {
		return fetch(url, {
			...options,
			credentials: "include",
		});
	},
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
