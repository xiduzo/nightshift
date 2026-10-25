import { describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";

import { decodedRequest, UnreadableBody } from "./request-encoding";

const post = (
	body: string | Uint8Array,
	headers: Record<string, string> = {},
) =>
	new Request("http://localhost:3000/rpc/sync/push", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body,
	});

async function refusal(request: Request, maxBytes?: number) {
	try {
		await decodedRequest(request, maxBytes);
	} catch (error) {
		return error instanceof UnreadableBody ? error.status : error;
	}
	throw new Error("The request was read.");
}

describe("a request body as the procedures read it", () => {
	test("a plain body stays as it is", async () => {
		const request = post('{"json":1}');
		expect(await decodedRequest(request)).toBe(request);
	});

	test("a gzip body is decompressed, without its encoding", async () => {
		const body = JSON.stringify({ json: "x".repeat(10_000) });
		const decoded = await decodedRequest(
			post(gzipSync(body), { "content-encoding": "gzip" }),
		);
		expect(decoded.headers.get("content-encoding")).toBeNull();
		expect(decoded.headers.get("content-type")).toBe("application/json");
		expect(await decoded.text()).toBe(body);
	});

	test("a body that is not valid gzip, or holds too much, is refused", async () => {
		expect(await refusal(post("plain", { "content-encoding": "gzip" }))).toBe(
			400,
		);
		expect(await refusal(post("plain", { "content-encoding": "br" }))).toBe(
			400,
		);
		const bomb = gzipSync(Buffer.alloc(1_000_000));
		expect(
			await refusal(post(bomb, { "content-encoding": "gzip" }), 100_000),
		).toBe(413);
	});
});
