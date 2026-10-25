import { describe, expect, test } from "bun:test";

import { appRouter } from "@nightshift/api";

import {
	createApiClient,
	createQueryUtils,
	STREAMING_PROCEDURES,
} from "./client";

/**
 * A fake `fetch` that records each request and answers `[]` the oRPC way,
 * a batch with `[]` for each of its calls. `reads`: what it says it
 * reads, as a Night Shift of this version does.
 */
function fakeFetch(reads?: string) {
	const requests: Request[] = [];
	const headers = {
		"content-type": "application/json",
		...(reads ? { "x-nightshift-reads": reads } : {}),
	};
	const fetch = async (request: Request) => {
		requests.push(request);
		if (new URL(request.url).pathname.endsWith("/__batch__")) {
			const calls = (await request.clone().json()) as unknown[];
			const replies = calls.map((_, index) => ({ index, body: { json: [] } }));
			return new Response(JSON.stringify(replies), { status: 207, headers });
		}
		return new Response(JSON.stringify({ json: [] }), { headers });
	};
	const paths = () => requests.map((r) => new URL(r.url).pathname);
	return { fetch, requests, paths };
}

describe("the client of a Night Shift", () => {
	test("calls a procedure below /rpc of the address, with the app's fetch and headers", async () => {
		const { fetch, requests } = fakeFetch();
		const client = createApiClient({
			baseUrl: "https://studio.tail1234.ts.net/",
			fetch,
			headers: () => ({ cookie: "session=abc" }),
		});
		const projects = await client.projects.list();
		expect(projects).toEqual([]);
		expect(requests).toHaveLength(1);
		const [request] = requests;
		expect(new URL(request?.url ?? "").pathname).toBe("/rpc/projects/list");
		expect(new URL(request?.url ?? "").origin).toBe(
			"https://studio.tail1234.ts.net",
		);
		expect(request?.headers.get("cookie")).toBe("session=abc");
	});

	test("keeps the query key of each procedure", () => {
		const { fetch } = fakeFetch();
		const orpc = createQueryUtils(
			createApiClient({ baseUrl: "http://localhost:3000", fetch }),
		);
		const options = orpc.runs.get.queryOptions({ input: { runId: "r1" } });
		expect(options.queryKey).toEqual(
			orpc.runs.get.queryKey({ input: { runId: "r1" } }),
		);
		expect(JSON.stringify(options.queryKey)).toContain('"runs","get"');
	});
});

describe("calls made together", () => {
	test("go in one request to a Night Shift of this version", async () => {
		const { fetch, paths } = fakeFetch();
		const client = createApiClient({
			baseUrl: "http://localhost:3000",
			fetch,
			batch: true,
		});
		const replies = await Promise.all([
			client.projects.list(),
			client.runs.list({}),
			client.gates.list(),
		]);
		expect(replies).toEqual([[], [], []]);
		expect(paths()).toEqual(["/rpc/__batch__"]);
	});

	test("go one by one to a Host until it says it reads batches", async () => {
		const older = fakeFetch();
		const toOlder = createApiClient({
			baseUrl: "https://host.example",
			fetch: older.fetch,
		});
		await Promise.all([toOlder.projects.list(), toOlder.runs.list({})]);
		await Promise.all([toOlder.projects.list(), toOlder.runs.list({})]);
		expect(older.paths()).not.toContain("/rpc/__batch__");
		expect(older.paths()).toHaveLength(4);

		const newer = fakeFetch("batch, gzip");
		const toNewer = createApiClient({
			baseUrl: "https://host.example",
			fetch: newer.fetch,
		});
		await toNewer.projects.list();
		await Promise.all([toNewer.projects.list(), toNewer.runs.list({})]);
		expect(newer.paths()).toEqual(["/rpc/projects/list", "/rpc/__batch__"]);
	});

	test("leave a stream out of the batch", async () => {
		const { fetch, paths } = fakeFetch();
		const client = createApiClient({
			baseUrl: "http://localhost:3000",
			fetch,
			batch: true,
		});
		const stop = new AbortController();
		const watching = client.notifications
			.watch({}, { signal: stop.signal })
			.catch(() => null);
		await Promise.all([client.projects.list(), client.runs.list({})]);
		stop.abort();
		await watching;
		expect(paths().sort()).toEqual([
			"/rpc/__batch__",
			"/rpc/notifications/watch",
		]);
	});

	test("know every procedure that streams", () => {
		const streaming: string[] = [];
		const walk = (node: unknown, path: string[]) => {
			if (!node || typeof node !== "object") return;
			const procedure = (node as { "~orpc"?: { handler?: unknown } })["~orpc"];
			if (procedure) {
				// A streaming procedure's handler yields its events.
				if (procedure.handler?.constructor.name === "AsyncGeneratorFunction") {
					streaming.push(path.join("."));
				}
				return;
			}
			for (const [key, child] of Object.entries(node))
				walk(child, [...path, key]);
		};
		walk(appRouter, []);
		expect([...STREAMING_PROCEDURES].sort()).toEqual(streaming.sort());
	});
});
