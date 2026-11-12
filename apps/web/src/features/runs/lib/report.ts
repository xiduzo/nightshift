import type { RunDetail, StepSummary } from "@/shared/api";

/**
 * Where a report opens: the page of its run, at the End step that wrote
 * it. Spread it on a `Link`.
 */
export function reportLink(report: { runId: string; stepId: string }) {
	return {
		to: "/runs/$runId",
		params: { runId: report.runId },
		search: { step: report.stepId },
	} as const;
}

/**
 * The report an End step wrote, from its outputs: the run page shows it in
 * the step even when the transcript is out of reach. `cut`: Night Shift
 * kept only the first 64 KB. Null for any other step, and for an End step
 * that wrote none.
 */
export function stepReport(
	step: Pick<StepSummary, "id" | "nodeType" | "outputs">,
	warnings: RunDetail["warnings"],
): { text: string; cut: boolean } | null {
	if (step.nodeType !== "end") return null;
	const text = step.outputs.report;
	if (typeof text !== "string" || text.trim() === "") return null;
	return {
		text,
		cut: warnings.some(
			(warning) => warning.kind === "report" && warning.stepId === step.id,
		),
	};
}

/** The name a report downloads as: `<flow>-report.md`, safe for any disk. */
export function reportFileName(flowName: string | null): string {
	const base = (flowName ?? "")
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `${base || "run"}-report.md`;
}
