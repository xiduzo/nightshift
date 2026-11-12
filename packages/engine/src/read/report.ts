import type { DerivedStep, RunState } from "../log";
import type { RunReportGlance } from "./views";

/**
 * The report of a run (ADR 26): what the run produced, in Markdown, for a
 * person to read. An End node writes it, and its step keeps it in its
 * outputs (`report`), at most 64 KB. The run's report is the report of
 * the End step that ended the run:
 *
 * - An End node ended the run (`RunEnded.result`). A run that failed,
 *   stopped or ended any other way has no report, and neither has a run
 *   that is open again.
 * - That End step is the newest one of the run's own flow (not in a
 *   called flow) that ended at or before the run's end. A rerun ends at a
 *   newer one, so its report replaces the older one.
 *
 * A summary carries only a glance (`RunReportGlance`): derived views
 * outlive the dropped logs (`run-log.ts`), so they never hold the full
 * text. The full text stays in the step's outputs (`RunDetail.steps`).
 */

/** The most characters of a report a glance carries (`excerpt`). */
export const REPORT_EXCERPT_CHARS = 600;

/** The glance of the run's report, or null when the run has none. */
export function reportOf(
	end: RunState["end"],
	steps: readonly DerivedStep[],
): RunReportGlance | null {
	if (end === null || end.result === null) return null;
	let found: { step: DerivedStep; seq: number } | null = null;
	for (const step of steps) {
		if (step.nodeType !== "end" || step.scope !== null) continue;
		const seq = step.openings.at(-1)?.end?.seq;
		if (seq === undefined || seq > end.seq) continue;
		if (found === null || seq > found.seq) found = { step, seq };
	}
	const text = found?.step.outputs.report;
	if (found === null || typeof text !== "string" || text === "") return null;
	return { stepId: found.step.id, ...reportExcerpt(text) };
}

/**
 * The start of a report, at most {@link REPORT_EXCERPT_CHARS} characters
 * of its Markdown: cut at the last line break, else at the last space
 * (when either is past the half), else before the character the cap falls
 * in. `more`: the report goes on.
 */
export function reportExcerpt(text: string): {
	excerpt: string;
	more: boolean;
} {
	if (text.length <= REPORT_EXCERPT_CHARS)
		return { excerpt: text, more: false };
	const head = text.slice(0, REPORT_EXCERPT_CHARS + 1);
	const half = REPORT_EXCERPT_CHARS / 2;
	let end = head.lastIndexOf("\n");
	if (end < half) end = head.lastIndexOf(" ");
	if (end < half) {
		end = REPORT_EXCERPT_CHARS;
		// Not between the two halves of a character outside the BMP.
		const code = text.charCodeAt(end - 1);
		if (code >= 0xd800 && code <= 0xdbff) end -= 1;
	}
	return { excerpt: text.slice(0, end).trimEnd(), more: true };
}
