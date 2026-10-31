/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { KEPT_MAX_AGE_MS } from "./kept-queries";
import { setPhoneQueryDefaults } from "./query-defaults";

const MINUTE_MS = 60 * 1000;

/** The options a read of `path` gets on the phone, keyed the way oRPC keys it. */
function defaultsOf(path: string[], type = "query") {
	const client = new QueryClient();
	setPhoneQueryDefaults(client);
	return client.defaultQueryOptions({
		queryKey: [path, { type, input: {} }],
	});
}

describe("how long a read stays fresh on the phone", () => {
	test("gates and runs stay fresh until the live cache marks them stale", () => {
		expect(defaultsOf(["gates", "list"]).staleTime).toBe(
			Number.POSITIVE_INFINITY,
		);
		expect(defaultsOf(["runs", "list"], "infinite").staleTime).toBe(
			Number.POSITIVE_INFINITY,
		);
		for (const kind of ["get", "step", "artifacts"]) {
			expect(defaultsOf(["runs", kind]).staleTime).toBe(
				Number.POSITIVE_INFINITY,
			);
		}
	});

	test("the dashboard stays fresh for 5 minutes", () => {
		expect(defaultsOf(["dashboard", "summary"]).staleTime).toBe(5 * MINUTE_MS);
		expect(defaultsOf(["dashboard", "flow"]).staleTime).toBe(5 * MINUTE_MS);
	});

	test("projects, flows, Spaces and schedules stay fresh for 10 minutes", () => {
		for (const path of ["projects", "flows", "spaces", "schedules"]) {
			expect(defaultsOf([path, "list"]).staleTime).toBe(10 * MINUTE_MS);
		}
	});

	test("a read the live cache does not mark keeps the shared default", () => {
		expect(defaultsOf(["runs", "moveTargets"]).staleTime).toBeUndefined();
		expect(defaultsOf(["devices", "list"]).staleTime).toBeUndefined();
	});
});

describe("how long a read stays in the cache on the phone", () => {
	test("a kept read stays as long as the phone keeps it", () => {
		expect(defaultsOf(["runs", "list"], "infinite").gcTime).toBe(
			KEPT_MAX_AGE_MS,
		);
		expect(defaultsOf(["gates", "list"]).gcTime).toBe(KEPT_MAX_AGE_MS);
		expect(defaultsOf(["dashboard", "summary"]).gcTime).toBe(KEPT_MAX_AGE_MS);
		expect(defaultsOf(["spaces", "list"]).gcTime).toBe(KEPT_MAX_AGE_MS);
	});

	test("the detail of a run keeps the shared default", () => {
		expect(defaultsOf(["runs", "get"]).gcTime).toBeUndefined();
	});
});
