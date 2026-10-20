import type { AppRouterClient } from "@nightshift/api/client";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { isSignInRequired } from "@/lib/access";
import { SERVER_URL } from "@/lib/server-url";
import { isTwoFactorRequired } from "@/lib/two-factor";

export function createQueryClient() {
	/**
	 * The Host refused the session: nobody is signed in (or the session
	 * ended), or two-factor must be on first. Read the account again, and
	 * the root sends the person to sign in or to the setup page. No toast.
	 * On this computer nobody signs in, so a refusal there still shows.
	 */
	const toAccess = (error: unknown) => {
		if (isSignInRequired(error)) {
			const status = client.getQueryData(orpc.account.status.queryKey());
			if (status?.thisComputer) return false;
		} else if (!isTwoFactorRequired(error)) {
			return false;
		}
		void client.invalidateQueries({ queryKey: orpc.account.status.key() });
		return true;
	};
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
