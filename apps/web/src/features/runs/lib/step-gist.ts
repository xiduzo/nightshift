import type { StepSummary } from "@/shared/api";

/** The output that says in words what a step did, by node type. */
const PROSE_OUTPUT: Partial<Record<StepSummary["nodeType"], string>> = {
	agent: "summary",
	decision: "note",
};

/** What the step did, in its own words: an Agent's summary, or a Decision's note. */
export function stepProse(
	step: Pick<StepSummary, "nodeType" | "outputs">,
): string | undefined {
	const field = PROSE_OUTPUT[step.nodeType];
	const value = field ? step.outputs[field] : undefined;
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** One line on what the step did, for a collapsed view: its error, else the first line of its prose or log. */
export function stepGist(
	step: Pick<StepSummary, "nodeType" | "outputs" | "error">,
): string | undefined {
	if (step.error) return step.error.split("\n")[0];
	const prose = stepProse(step);
	if (prose) return prose.split("\n")[0];
	const logTail = step.outputs.log_tail;
	if (typeof logTail === "string" && logTail.trim()) {
		return logTail.trim().split("\n").at(-1);
	}
	return undefined;
}
