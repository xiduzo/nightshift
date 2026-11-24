import { expect, test } from "bun:test";

import { daysOf } from "./days";
import type { DashboardSummary, NightsRange } from "./types";

test("daysOf picks the range, and says when the server has none", () => {
	const range = (nights: NightsRange["nights"], count: number) =>
		({ nights, reports: { rows: [], count } }) as unknown as NightsRange;
	const summary = {
		nights: [range(7, 1), range(30, 5)],
	} as DashboardSummary;
	expect(daysOf(summary, 30).reports.count).toBe(5);
	expect(() => daysOf(summary, 90)).toThrow("no range of 90 days");
});
