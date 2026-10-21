import { describe, expect, test } from "bun:test";

import { createApiClient, createQueryUtils } from "./client";

/** A fake `fetch` that records each request and answers `[]` the oRPC way. */
function fakeFetch() {
	const requests: Request[] = [];
	const fetch = async (request: Request) => {
		requests.push(request);
		return new Response(JSON.stringify({ json: [] }), {
			headers: { "content-type": "application/json" },
		});
	};
	return { fetch, requests };
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
