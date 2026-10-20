import type { AppRouterClient } from "@nightshift/api";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { pinnedFetch } from "./tls";

/**
 * The procedures of a Host at one address, as a Device calls them: with its
 * Device key once it has one, trusting only the pinned certificate when it
 * pinned one.
 */
export function hostClient(
	address: string,
	options: { key?: string; certificate?: string | null } = {},
): AppRouterClient {
	const send = pinnedFetch(options.certificate ?? null);
	const link = new RPCLink({
		url: `${address.replace(/\/$/, "")}/rpc`,
		headers: options.key ? { authorization: `Bearer ${options.key}` } : {},
		fetch: (request, init) => send(request, init),
	});
	return createORPCClient(link);
}
