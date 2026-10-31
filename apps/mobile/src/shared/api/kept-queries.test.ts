/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { firstPageOnly, keptQuery } from "./kept-queries";

describe("what the phone writes of the kept reads", () => {
	const kept = (
		queries: { queryKey: unknown[]; state: { data?: unknown } }[],
	) => ({
		buster: "1",
		timestamp: 0,
		clientState: { mutations: [], queries },
	});

	test("keeps only the first page of a read in pages", () => {
		const data = { pages: [["r1", "r2"], ["r3"]], pageParams: [null, "r2"] };
		const pages = {
			queryKey: [["runs", "list"], { type: "infinite", input: {} }],
			state: { data },
		};
		const written = firstPageOnly(kept([pages]));
		expect(written.clientState.queries[0]?.state.data).toEqual({
			pages: [["r1", "r2"]],
			pageParams: [null],
		});
		// What the cache holds stays the same.
		expect(data.pages).toHaveLength(2);
	});

	test("keeps a plain read as it is", () => {
		const plain = {
			queryKey: [["gates", "list"], { type: "query" }],
			state: { data: [{ runId: "r1" }] },
		};
		expect(firstPageOnly(kept([plain])).clientState.queries[0]).toBe(plain);
	});
});

/** A query with `queryKey`, read or not yet. */
const query = (queryKey: unknown[], status: "success" | "error" = "success") =>
	({ queryKey, state: { status } }) as Parameters<typeof keptQuery>[0];

describe("the reads the phone keeps between starts", () => {
	test("are the lists its tabs show first", () => {
		expect(
			keptQuery(query([["runs", "list"], { type: "query", input: {} }])),
		).toBe(true);
		expect(keptQuery(query([["gates", "list"], { type: "query" }]))).toBe(true);
		// The Runs tab reads its runs a page at a time.
		expect(
			keptQuery(query([["runs", "list"], { type: "infinite", input: {} }])),
		).toBe(true);
		expect(
			keptQuery(query([["dashboard", "summary"], { type: "query" }])),
		).toBe(true);
	});

	test("are not the detail of a run, a stream, a failed read or the session", () => {
		expect(
			keptQuery(
				query([["runs", "get"], { type: "query", input: { runId: "r1" } }]),
			),
		).toBe(false);
		expect(keptQuery(query([["runs", "list"], { type: "streamed" }]))).toBe(
			false,
		);
		expect(
			keptQuery(query([["runs", "list"], { type: "query" }], "error")),
		).toBe(false);
		expect(
			keptQuery(query(["host", "session", "https://studio.example.com"])),
		).toBe(false);
	});
});
