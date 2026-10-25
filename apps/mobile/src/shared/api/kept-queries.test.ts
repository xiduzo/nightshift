/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { keptQuery } from "./kept-queries";

/** A query with `queryKey`, read or not yet. */
const query = (queryKey: unknown[], status: "success" | "error" = "success") =>
	({ queryKey, state: { status } }) as Parameters<typeof keptQuery>[0];

describe("the reads the phone keeps between starts", () => {
	test("are the lists its tabs show first", () => {
		expect(
			keptQuery(query([["runs", "list"], { type: "query", input: {} }])),
		).toBe(true);
		expect(keptQuery(query([["gates", "list"], { type: "query" }]))).toBe(true);
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
