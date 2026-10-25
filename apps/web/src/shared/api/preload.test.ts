import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { preloadQuery } from "./preload";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("starting a page's data early", () => {
	const browser = globalThis as { window?: unknown };
	let calls = 0;
	const runQuery = (fail = false) => ({
		queryKey: ["runs", "get", "run-1"],
		queryFn: async () => {
			calls += 1;
			if (fail) throw new Error("The run is gone");
			return { id: "run-1" };
		},
	});

	beforeEach(() => {
		calls = 0;
		browser.window = globalThis;
	});
	afterEach(() => {
		delete browser.window;
	});

	test("loads what is not in the cache yet", async () => {
		const queryClient = new QueryClient();
		preloadQuery(queryClient, runQuery());
		await settle();
		expect(calls).toBe(1);
		expect(
			queryClient.getQueryData<{ id: string }>(["runs", "get", "run-1"]),
		).toEqual({
			id: "run-1",
		});
	});

	test("leaves what is in the cache to the page", async () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(["runs", "get", "run-1"], { id: "run-1" });
		preloadQuery(queryClient, runQuery());
		await settle();
		expect(calls).toBe(0);
	});

	test("does not throw on a failure: the page shows it", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		expect(() => preloadQuery(queryClient, runQuery(true))).not.toThrow();
		await settle();
		expect(
			queryClient.getQueryState(["runs", "get", "run-1"])?.error?.message,
		).toBe("The run is gone");
	});

	test("loads nothing on the server, which has no session", async () => {
		delete browser.window;
		const queryClient = new QueryClient();
		preloadQuery(queryClient, runQuery());
		await settle();
		expect(calls).toBe(0);
	});
});
