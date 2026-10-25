import { promisify } from "node:util";
import { gunzip } from "node:zlib";

/** The most a compressed request body may hold once decompressed. */
export const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

/** The request body would hold more than `MAX_REQUEST_BYTES`, or is not valid gzip. */
export class UnreadableBody extends Error {
	constructor(readonly status: 400 | 413) {
		super(
			status === 413
				? "This request is too large."
				: "This request is not valid.",
		);
	}
}

const gunzipAsync = promisify(gunzip);

/**
 * The request as the procedures read it: a body sent with
 * `Content-Encoding: gzip` decompressed, up to `maxBytes`. Any other
 * request as it is.
 */
export async function decodedRequest(
	request: Request,
	maxBytes = MAX_REQUEST_BYTES,
): Promise<Request> {
	const encoding = request.headers.get("content-encoding")?.trim();
	if (!encoding || encoding === "identity") return request;
	if (encoding.toLowerCase() !== "gzip") throw new UnreadableBody(400);
	let body: Buffer;
	try {
		body = await gunzipAsync(Buffer.from(await request.arrayBuffer()), {
			maxOutputLength: maxBytes,
		});
	} catch (error) {
		throw new UnreadableBody(error instanceof RangeError ? 413 : 400);
	}
	const headers = new Headers(request.headers);
	headers.delete("content-encoding");
	headers.delete("content-length");
	return new Request(request.url, {
		method: request.method,
		headers,
		body: new Uint8Array(body),
		signal: request.signal,
	});
}
