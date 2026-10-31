import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { createApiClient, createQueryUtils } from "../api";
import { createDashboardQueries } from "../dashboard";
import { cachedRunSummary, runPlaceholder } from "./placeholder";
import { createRunQueries } from "./queries";
import type { RunSummary } from "./types";

/** Only the query keys are used. */
const orpc = createQueryUtils(
	createApiClient({ link: { call: () => new Promise(() => {}) } }),
);
const runs = createRunQueries(orpc);
const dashboard = createDashboardQueries(orpc);

const run = (id: string, status: RunSummary["status"] = "running") =>
	({ id, projectId: "p1", title: `Run ${id}`, status }) as RunSummary;

/** Sets the data of a query, as read at `at`. */
function seed(
	client: QueryClient,
	queryKey: readonly unknown[],
	data: unknown,
	at: number,
) {
	client.setQueryData(queryKey, data, { updatedAt: at });
}

describe("a run screen starts from the lists in the cache", () => {
	test("finds the run in a list, in the pages of a list, and in last night", () => {
		const client = new QueryClient();
		seed(client, runs.open().queryKey, [run("a")], 1);
		seed(
			client,
			runs.pages({}, 2).queryKey,
			{ pages: [[run("b"), run("c")], [run("d")]], pageParams: [] },
			1,
		);
		seed(
			client,
			dashboard.summary().queryKey,
			{ lastNight: { latest: [{ ...run("e"), group: "website" }] } },
			1,
		);
		expect(cachedRunSummary(client, orpc, "a")?.title).toBe("Run a");
		expect(cachedRunSummary(client, orpc, "d")?.title).toBe("Run d");
		// The dashboard's group is not part of a run.
		expect(cachedRunSummary(client, orpc, "e")).toEqual(run("e"));
		expect(cachedRunSummary(client, orpc, "x")).toBeUndefined();
	});

	test("the newest read wins, so the status is the one last seen", () => {
		const client = new QueryClient();
		seed(client, runs.everyRun().queryKey, [run("a", "running")], 1);
		seed(client, runs.latest(5).queryKey, [run("a", "finished")], 2);
		expect(cachedRunSummary(client, orpc, "a")?.status).toBe("finished");
	});

	test("the dashboard's open rows are not full runs and do not count", () => {
		const client = new QueryClient();
		seed(
			client,
			dashboard.summary().queryKey,
			{ open: { rows: [{ id: "a", title: "Run a", status: "running" }] } },
			1,
		);
		expect(cachedRunSummary(client, orpc, "a")).toBeUndefined();
	});

	test("the placeholder has the summary and no steps yet", () => {
		const client = new QueryClient();
		seed(client, runs.everyRun().queryKey, [run("a")], 1);
		const detail = runPlaceholder(client, orpc, "a");
		expect(detail?.title).toBe("Run a");
		expect(detail?.projectId).toBe("p1");
		expect(detail?.steps).toEqual([]);
		expect(runPlaceholder(client, orpc, "x")).toBeUndefined();
	});

	test("the detail query shows the placeholder only with a query client", () => {
		const client = new QueryClient();
		seed(client, runs.everyRun().queryKey, [run("a")], 1);
		expect("placeholderData" in runs.get("a")).toBe(false);
		const options = runs.get("a", client);
		expect(options.queryKey).toEqual(runs.get("a").queryKey);
		const placeholder =
			typeof options.placeholderData === "function"
				? options.placeholderData()
				: undefined;
		expect(placeholder?.title).toBe("Run a");
	});
});
