import { describe, expect, test } from "bun:test";

import { runReport } from "./report";
import type { RunDetail } from "./types";

type Detail = Pick<RunDetail, "report" | "steps" | "warnings">;

const endStep = (outputs: Record<string, unknown>) =>
	({
		id: "end-1",
		nodeId: "done",
		outputs,
	}) as unknown as RunDetail["steps"][number];

const detail = (extra: Partial<Detail> = {}): Detail => ({
	report: { stepId: "end-1", excerpt: "## News", more: true },
	steps: [endStep({ message: "", report: "## News\n\nThe whole text." })],
	warnings: [],
	...extra,
});

describe("runReport", () => {
	test("is the whole text from the End step's outputs", () => {
		expect(runReport(detail())).toEqual({
			stepId: "end-1",
			text: "## News\n\nThe whole text.",
			partial: false,
			cut: false,
		});
	});

	test("is null for a run without a report, as from an older Host", () => {
		expect(runReport(detail({ report: undefined }))).toBeNull();
	});

	test("falls back to the excerpt when the step is not at hand", () => {
		expect(runReport(detail({ steps: [] }))).toEqual({
			stepId: "end-1",
			text: "## News",
			partial: true,
			cut: false,
		});
	});

	test("says Night Shift cut it when that step has a report warning", () => {
		const warning = (stepId: string) => ({
			kind: "report" as const,
			message: "This report is longer than 64 KB.",
			stepId,
			nodeId: "done",
			at: 1,
		});
		expect(runReport(detail({ warnings: [warning("end-1")] }))?.cut).toBe(true);
		expect(runReport(detail({ warnings: [warning("other")] }))?.cut).toBe(
			false,
		);
	});
});
