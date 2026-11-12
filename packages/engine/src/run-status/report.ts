/**
 * The report of a run (ADR 26) as a reader reads it from the run's
 * detail: the web, the phone and `nightshift mcp`. The End node that ended
 * the run wrote it. The run's summary carries only its start (`report`:
 * the End step and an excerpt, `read/report.ts`). The full text is that
 * step's output `report`.
 */
export type RunReport = {
	/** The End step that wrote it: the run page opens there. */
	stepId: string;
	/** The whole report, or its start when the step is not at hand (`partial`). */
	text: string;
	/** `text` is only the start of the report: the step was not at hand. */
	partial: boolean;
	/** Night Shift kept only the first 64 KB of a longer report. */
	cut: boolean;
};

/** What the report reads of a run's detail. */
type ReportSource = {
	report?: { stepId: string; excerpt: string; more: boolean };
	steps: readonly { id: string; outputs: Readonly<Record<string, unknown>> }[];
	warnings: readonly { kind: string; stepId: string | null }[];
};

/**
 * The run's report, or null when the run has none. An older Host sends
 * no report, so its runs have none here.
 */
export function runReport(detail: ReportSource): RunReport | null {
	const glance = detail.report;
	if (!glance) return null;
	const output = detail.steps.find((step) => step.id === glance.stepId)?.outputs
		.report;
	const whole = typeof output === "string" && output !== "" ? output : null;
	return {
		stepId: glance.stepId,
		text: whole ?? glance.excerpt,
		partial: whole === null && glance.more,
		cut: detail.warnings.some(
			(warning) =>
				warning.kind === "report" && warning.stepId === glance.stepId,
		),
	};
}
