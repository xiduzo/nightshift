import { describe, expect, test } from "bun:test";

import { createApiClient, createQueryUtils } from "../api";
import { createDashboardQueries, readerTimeZone } from "./queries";

const orpc = createQueryUtils(
	createApiClient({ baseUrl: "http://localhost:3000" }),
);
const dashboard = createDashboardQueries(orpc);

/** The polling rule of a query, on this data. */
function intervalOn(
	options: ReturnType<typeof dashboard.summary>,
	data: { open: { count: number } } | undefined,
) {
	return options.refetchInterval({ state: { data } });
}

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

	test("polls every 5 seconds while a run is open, else once a minute", () => {
		const options = dashboard.summary();
		expect(intervalOn(options, { open: { count: 2 } })).toBe(5000);
		expect(intervalOn(options, { open: { count: 0 } })).toBe(60_000);
		expect(intervalOn(options, undefined)).toBe(60_000);
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
