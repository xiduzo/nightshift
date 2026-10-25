import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { createApiClient, createQueryUtils } from "../api";
import { spaceChanged } from "./space-changed";

const orpc = createQueryUtils(
	createApiClient({
		baseUrl: "http://localhost:3000",
		fetch: () => Promise.reject(new TypeError("no Host in this test")),
	}),
);

describe("a switch of the active Space", () => {
	test("forgets what the cache holds of the Space before, also of queries no screen shows", async () => {
		const queryClient = new QueryClient();
		// Untyped: only whether the cache still holds them counts.
		const projects: readonly unknown[] = orpc.projects.list.queryKey();
		const gates: readonly unknown[] = orpc.gates.list.queryKey();
		const session = ["host", "session", "https://studio.example.com"];
		queryClient.setQueryData(projects, ["Space A's project"]);
		queryClient.setQueryData(gates, ["a Gate of any Space"]);
		queryClient.setQueryData(session, { user: "Ada" });

		await spaceChanged(queryClient);

		expect(queryClient.getQueryData(projects)).toBeUndefined();
		// The open Gates span every Space, and the app's own queries are not of a Space.
		expect(queryClient.getQueryData<unknown>(gates)).toEqual([
			"a Gate of any Space",
		]);
		expect(queryClient.getQueryData<unknown>(session)).toEqual({ user: "Ada" });
	});
});
