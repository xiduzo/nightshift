import { describe, expect, test } from "bun:test";

import { createApiClient, createQueryUtils } from "../api";
import { createDashboardQueries, readerTimeZone } from "./queries";

const orpc = createQueryUtils(
	createApiClient({ baseUrl: "http://localhost:3000" }),
);
const dashboard = createDashboardQueries(orpc);

describe("the dashboard query", () => {
	test("asks for the numbers on this screen's clock", () => {
		const options = dashboard.summary({ projectId: "p1" });
		const [, { input }] = options.queryKey as unknown as [
			unknown,
			{ input: unknown },
		];
		expect(input).toEqual({ projectId: "p1", timeZone: readerTimeZone() });
		expect(readerTimeZone()).toBeString();
	});

	test("polls every 5 minutes: the live cache reads it again with the runs", () => {
		expect(dashboard.summary().refetchInterval).toBe(300_000);
		expect(dashboard.summary({ everySpace: true }).refetchInterval).toBe(
			300_000,
		);
		expect(dashboard.changes("p1", "night", 7).refetchInterval).toBe(300_000);
	});

	test("keeps the keys of its procedures", () => {
		expect(dashboard.changes("p1", "night", 7).queryKey).toEqual(
			orpc.dashboard.changes.queryKey({
				input: {
					projectId: "p1",
					flowName: "night",
					nights: 7,
					timeZone: readerTimeZone(),
				},
			}),
		);
	});
});
