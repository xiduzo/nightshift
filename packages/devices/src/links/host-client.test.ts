import { afterEach, describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { READS, READS_HEADER } from "../contract";
import { hostClient } from "./host-client";

/** What a Host got: each call's path, encoding and body as JSON text. */
type Received = { path: string; encoding: string | null; body: string };

let server: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
	server?.stop(true);
	server = null;
});

/** A Host that answers every call with `null`, saying it reads gzip or not. */
function host(saysReads: boolean) {
	const received: Received[] = [];
	server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(request) {
			const raw = new Uint8Array(await request.arrayBuffer());
			const encoding = request.headers.get("content-encoding");
			received.push({
				path: new URL(request.url).pathname,
				encoding,
				body: (encoding === "gzip"
					? gunzipSync(raw)
					: Buffer.from(raw)
				).toString(),
			});
			return Response.json(
				{ json: null },
				{ headers: saysReads ? { [READS_HEADER]: READS } : {} },
			);
		},
	});
	return { url: `http://127.0.0.1:${server.port}`, received };
}

const ref = { kind: "checkpoint", spaceId: "s1", runId: "r1" } as const;
const large = "x".repeat(20_000);

describe("a Device's calls to its Host", () => {
	test("send a large body compressed once the Host says it reads gzip", async () => {
		const { url, received } = host(true);
		const client = hostClient(url, { key: "k" });
		await client.archive.put({ ref, content: large });
		await client.archive.put({ ref, content: large });
		await client.archive.put({ ref, content: "small" });
		expect(received.map((r) => r.encoding)).toEqual([null, "gzip", null]);
		expect(received[1]?.path).toBe("/rpc/archive/put");
		expect(JSON.parse(received[1]?.body ?? "{}").json.content).toBe(large);
	});

	test("send plain bodies to a Host of an older version", async () => {
		const { url, received } = host(false);
		const client = hostClient(url, { key: "k" });
		await client.archive.put({ ref, content: large });
		await client.archive.put({ ref, content: large });
		expect(received.map((r) => r.encoding)).toEqual([null, null]);
		expect(JSON.parse(received[1]?.body ?? "{}").json.content).toBe(large);
	});
});
