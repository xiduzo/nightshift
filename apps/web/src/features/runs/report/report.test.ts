import { describe, expect, test } from "bun:test";
import type { RunDetail } from "@/shared/api";
import { reportFileName, reportLink, stepReport } from "./report";

const warning = (
	kind: RunDetail["warnings"][number]["kind"],
	stepId: string | null,
): RunDetail["warnings"][number] => ({
	kind,
	message: "This report is longer than 64 KB.",
	stepId,
	nodeId: null,
	at: 1,
});

describe("the report of an End step", () => {
	test("its report output, and whether Night Shift cut it", () => {
		const step = {
			id: "s9",
			nodeType: "end" as const,
			outputs: { message: "Done", report: "## What is new\n\n- One" },
		};
		expect(stepReport(step, [])).toEqual({
			text: "## What is new\n\n- One",
			cut: false,
		});
		expect(stepReport(step, [warning("report", "s9")])).toEqual({
			text: "## What is new\n\n- One",
			cut: true,
		});
		// A cut of another step, or another warning of this one, is not this cut.
		expect(
			stepReport(step, [warning("report", "s1"), warning("shape", "s9")])?.cut,
		).toBe(false);
	});

	test("none from an End step without one, a blank one, or another node", () => {
		expect(
			stepReport({ id: "s1", nodeType: "end", outputs: { message: "" } }, []),
		).toBeNull();
		expect(
			stepReport({ id: "s1", nodeType: "end", outputs: { report: " \n" } }, []),
		).toBeNull();
		expect(
			stepReport(
				{ id: "s1", nodeType: "agent", outputs: { report: "## Notes" } },
				[],
			),
		).toBeNull();
	});
});

describe("where a report opens", () => {
	test("the run's page at the End step", () => {
		expect(reportLink({ runId: "r1", stepId: "s9" })).toEqual({
			to: "/runs/$runId",
			params: { runId: "r1" },
			search: { step: "s9" },
		});
	});
});

describe("the file a report downloads as", () => {
	test("the flow's name, safe for any disk", () => {
		expect(reportFileName("market-update")).toBe("market-update-report.md");
		expect(reportFileName("Weekly Café notes!")).toBe(
			"weekly-cafe-notes-report.md",
		);
		expect(reportFileName(null)).toBe("run-report.md");
		expect(reportFileName("***")).toBe("run-report.md");
	});
});
