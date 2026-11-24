import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { HostClient } from "../contract";
import { pinnedFetch } from "../reach";

/** A request body this large goes compressed. */
const GZIP_FROM_BYTES = 8 * 1024;

const gzipAsync = promisify(gzip);

/**
 * The procedures of a Host at one address, as a Device calls them: the
 * Host's contract over HTTPS, `HostClient`'s production adapter. With its
 * Device key once it has one, trusting only the pinned certificate when
 * it pinned one. Each call goes on its own. A large body (a batch of rows,
 * a transcript) goes compressed.
 */
export function hostClient(
	address: string,
	options: { key?: string; certificate?: string | null } = {},
): HostClient {
	const send = pinnedFetch(options.certificate ?? null);
	const link = new RPCLink({
		url: `${address.replace(/\/$/, "")}/rpc`,
		headers: options.key ? { authorization: `Bearer ${options.key}` } : {},
		fetch: async (request, init) => send(await compressed(request), init),
	});
	return createORPCClient(link);
}

/** The request with its body compressed, when it has a large one. */
async function compressed(request: Request): Promise<Request> {
	if (request.method === "GET" || request.method === "HEAD" || !request.body) {
		return request;
	}
	const body = new Uint8Array(await request.arrayBuffer());
	const headers = new Headers(request.headers);
	const large = body.byteLength >= GZIP_FROM_BYTES;
	if (large) {
		headers.set("content-encoding", "gzip");
		headers.delete("content-length");
	}
	return new Request(request.url, {
		method: request.method,
		headers,
		body: large ? new Uint8Array(await gzipAsync(body)) : body,
		signal: request.signal,
	});
}
