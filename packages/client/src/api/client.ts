import type { ClientContext, ClientLink } from "@orpc/client";
import { createORPCClient } from "@orpc/client";
import { RPCLink, type RPCLinkOptions } from "@orpc/client/fetch";
import { BatchLinkPlugin } from "@orpc/client/plugins";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import type { ApiClient, ApiQueryUtils } from "./types";

/** Where a Night Shift answers oRPC calls, below its address. */
export const RPC_PATH = "/rpc";

/**
 * What a Night Shift says it reads beyond one plain call, on each answer
 * of its procedures: `batch` when it answers several calls in one request.
 * The same header as `READS_HEADER` of `@nightshift/devices`. A Night
 * Shift of an older version says nothing.
 */
const READS_HEADER = "x-nightshift-reads";

/**
 * The procedures that stream. A batch carries no stream, so each goes in
 * its own request.
 */
export const STREAMING_PROCEDURES: readonly string[] = [
	"runs.watch",
	"notifications.watch",
	"devices.join",
	"devices.work",
	"devices.call",
	"sync.stream",
	"sync.commands",
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
	/**
	 * The calls made together go in one request. `true`: from the first
	 * call, for a Night Shift of this version (the one that served the web
	 * app). Without it: once the Night Shift says it reads batches, so a
	 * Host of an older version gets plain calls.
	 */
	batch?: boolean;
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

/** The link over HTTP. The calls made together go in one batch when the Night Shift reads batches. */
function transportLink(transport: ApiTransport): ClientLink<ClientContext> {
	const known = transport.batch === true;
	let batches = known;
	const send: NonNullable<ApiTransport["fetch"]> =
		transport.fetch ?? ((request, init) => fetch(request, init));
	const streams = new Set(STREAMING_PROCEDURES);
	const url = `${transport.baseUrl.replace(/\/$/, "")}${RPC_PATH}`;
	return new RPCLink({
		url,
		headers: transport.headers,
		async fetch(...call) {
			const response = await send(...call);
			// Each answer says it again: a Host that went back to an older
			// version gets plain calls from the next one on.
			if (!known) {
				batches = (response.headers.get(READS_HEADER) ?? "")
					.split(",")
					.some((word) => word.trim() === "batch");
			}
			return response;
		},
		plugins: [
			new BatchLinkPlugin({
				groups: [{ condition: () => batches, context: {} }],
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
