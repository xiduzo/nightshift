import type { ClientContext, ClientLink } from "@orpc/client";
import { createORPCClient } from "@orpc/client";
import { RPCLink, type RPCLinkOptions } from "@orpc/client/fetch";
import { BatchLinkPlugin } from "@orpc/client/plugins";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import type { ApiClient, ApiQueryUtils } from "./types";

/** Where a Night Shift answers oRPC calls, below its address. */
export const RPC_PATH = "/rpc";

/**
 * The procedures that stream. A batch carries no stream, so each goes in
 * its own request.
 */
export const STREAMING_PROCEDURES: readonly string[] = [
	"assistant.suggest",
	"assistant.chat",
	"assistant.explain",
	"runs.watch",
	"notifications.watch",
	"devices.join",
	"devices.work",
	"devices.call",
	"sync.stream",
	"sync.commands",
	"sync.pending",
	"archive.follow",
];

/** The most calls in one batch: what a Night Shift takes in one. */
const MAX_BATCH = 10;

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
	return createORPCClient(
		"link" in options ? options.link : transportLink(options),
	);
}

/** The link over HTTP. The calls made together go in one batch. */
function transportLink(transport: ApiTransport): ClientLink<ClientContext> {
	const streams = new Set(STREAMING_PROCEDURES);
	const url = `${transport.baseUrl.replace(/\/$/, "")}${RPC_PATH}`;
	return new RPCLink({
		url,
		headers: transport.headers,
		...(transport.fetch ? { fetch: transport.fetch } : {}),
		plugins: [
			new BatchLinkPlugin({
				groups: [{ condition: () => true, context: {} }],
				exclude: ({ path }) => streams.has(path.join(".")),
				maxSize: MAX_BATCH,
				url: `${url}/__batch__`,
				// One reply for the whole batch, which the Night Shift compresses.
				mode: "buffered",
			}),
		],
	});
}

/** The query keys, query options and mutation options of a client, for TanStack Query. */
export function createQueryUtils(client: ApiClient): ApiQueryUtils {
	return createTanstackQueryUtils(client);
}
