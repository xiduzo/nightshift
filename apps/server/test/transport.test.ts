import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { AppRouterClient } from "@nightshift/api";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { BatchLinkPlugin } from "@orpc/client/plugins";

import { type Daemon, startDaemon, stopDaemon } from "./test-daemons";

/**
 * How the procedures travel, end to end on a real daemon: a batch of
 * calls, compressed replies, a compressed request body, and the header
 * that tells a caller what this daemon reads.
 */

const root = mkdtempSync(join(tmpdir(), "nightshift-transport-"));
let daemon: Daemon;

beforeAll(async () => {
	daemon = await startDaemon(root, "daemon", {});
}, 60_000);

afterAll(async () => {
	await stopDaemon(daemon);
	rmSync(root, { recursive: true, force: true });
});

describe("the procedures over HTTP", () => {
	test("a batch of calls is one request, and each call gets its own reply", async () => {
		const requests: string[] = [];
		const client: AppRouterClient = createORPCClient(
			new RPCLink({
				url: `${daemon.url}/rpc`,
				fetch: (request, init) => {
					requests.push(new URL(request.url).pathname);
					return fetch(request, init);
				},
				plugins: [
					new BatchLinkPlugin({
						groups: [{ condition: () => true, context: {} }],
						url: `${daemon.url}/rpc/__batch__`,
						mode: "buffered",
					}),
				],
			}),
		);
		const [runs, projects, missing] = await Promise.allSettled([
			client.runs.list({}),
			client.projects.list(),
			client.runs.get({ runId: "no-such-run" }),
		]);
		expect(requests).toEqual(["/rpc/__batch__"]);
		expect(runs).toEqual({ status: "fulfilled", value: [] });
		expect(projects.status).toBe("fulfilled");
		expect(missing.status).toBe("rejected");
	});

	test("an answer says what the daemon reads, and a large one comes compressed", async () => {
		const response = await fetch(`${daemon.url}/rpc/__batch__`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"accept-encoding": "gzip",
				"x-orpc-batch": "buffered",
			},
			body: JSON.stringify(
				Array.from({ length: 10 }, () => ({
					url: `${daemon.url}/rpc/runs/get`,
					body: { json: { runId: "no-such-run" } },
				})),
			),
			decompress: false,
		});
		expect(response.headers.get("x-nightshift-reads")).toBe("batch, gzip");
		expect(response.headers.get("content-encoding")).toBe("gzip");
		expect(response.headers.get("vary")).toContain("Accept-Encoding");
	});

	test("a request body sent compressed is read", async () => {
		const response = await fetch(`${daemon.url}/rpc/runs/list`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"content-encoding": "gzip",
			},
			body: gzipSync(JSON.stringify({ json: {} })),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ json: [] });
	});
});
