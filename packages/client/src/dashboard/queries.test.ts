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

	test("polls once a minute, also while a run is open", () => {
		expect(dashboard.summary().refetchInterval).toBe(60_000);
		expect(dashboard.summary({ everySpace: true }).refetchInterval).toBe(
			60_000,
		);
		expect(dashboard.flow("p1", "night").refetchInterval).toBe(60_000);
	});

	test("keeps the keys of its procedures", () => {
		expect(dashboard.all()).toEqual(orpc.dashboard.key());
		expect(dashboard.flow("p1", "night").queryKey).toEqual(
			orpc.dashboard.flow.queryKey({
				input: {
					projectId: "p1",
					flowName: "night",
					timeZone: readerTimeZone(),
				},
			}),
		);
	});
});
