import type { AppRouterClient } from "@nightshift/api/client";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { fetch as expoFetch } from "expo/fetch";

import type { HostAuthClient } from "./auth-client";

/**
 * The oRPC client of one Host. It sends the session cookie that the auth
 * client keeps, because React Native has no cookie jar of its own.
 * `expo/fetch` streams a response, so event iterators (a run's live log)
 * work too.
 */
export function createHostClient(address: string, auth: HostAuthClient) {
	const link = new RPCLink({
		url: `${address}/rpc`,
		async fetch(request, init) {
			const hasBody = request.method !== "GET" && request.method !== "HEAD";
			return expoFetch(request.url, {
				...init,
				method: request.method,
				headers: Object.fromEntries(request.headers),
				body: hasBody ? await request.arrayBuffer() : undefined,
				signal: request.signal,
				credentials: "omit",
			}) as unknown as Promise<Response>;
		},
		async headers() {
			const cookie = await auth.getCookie();
			return cookie ? { cookie } : {};
		},
	});
	const client: AppRouterClient = createORPCClient(link);
	return { client, orpc: createTanstackQueryUtils(client) };
}

export type HostClient = ReturnType<typeof createHostClient>;
