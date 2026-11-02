import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient } from "@tanstack/react-query";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import type { AdminRouter } from "@/contract";

export const authClient = createAuthClient({
	plugins: [twoFactorClient()],
});

const link = new RPCLink({
	url: `${window.location.origin}/rpc`,
});

const client: RouterClient<AdminRouter> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);

export function createQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
	});
}
