import type { ClientContext, ClientLink } from "@orpc/client";
import { createORPCClient } from "@orpc/client";
import { RPCLink, type RPCLinkOptions } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import type { ApiClient, ApiQueryUtils } from "./types";

/** Where a Night Shift answers oRPC calls, below its address. */
export const RPC_PATH = "/rpc";

/**
 * How a client reaches a Night Shift: its address and, when the platform
 * needs them, its own `fetch` and the headers of each call. The web app
 * sends the session cookie (`credentials: "include"`); the phone passes
 * `expo/fetch` and the cookie of its session as a header.
 */
export type ApiTransport = {
	/** The address of the Night Shift, without `/rpc` (`https://studio.tail1234.ts.net`). */
	baseUrl: string;
	/** The `fetch` to call it with. Without it, the platform's own. */
	fetch?: RPCLinkOptions<ClientContext>["fetch"];
	/** The headers of each call, or a function that gives them per call. */
	headers?: RPCLinkOptions<ClientContext>["headers"];
};

/** A transport, or a link the app made itself (a test, another protocol). */
export type ApiClientOptions =
	| ApiTransport
	| { link: ClientLink<ClientContext> };

/**
 * Makes the typed client of one Night Shift. It keeps no global state: each
 * app makes its own and holds it.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
	const link =
		"link" in options
			? options.link
			: new RPCLink({
					url: `${options.baseUrl.replace(/\/$/, "")}${RPC_PATH}`,
					fetch: options.fetch,
					headers: options.headers,
				});
	return createORPCClient(link);
}

/** The query keys, query options and mutation options of a client, for TanStack Query. */
export function createQueryUtils(client: ApiClient): ApiQueryUtils {
	return createTanstackQueryUtils(client);
}
