import type { StepSummary } from "./types";

/** How long a run took: open from start to end, and how much of that it waited for a person. */
export type RunTime = {
	/** From the run's start to the last step's end, or to now while a step runs. */
	open: number;
	/** The time a Gate was open and no other step ran. */
	waited: number;
	/** `open` without `waited`: the time the run worked. */
	active: number;
	/** A step still runs or waits: the times grow with `now`. */
	going: boolean;
};

type Span = [number, number];

/**
 * How long the run took, with the time it waited for a person at a Gate
 * set apart. A Gate that is open while another step runs does not count as
 * waiting: the run still works. A Call step that called other steps does
 * not count as working on its own.
 */
export function runTime(
	steps: readonly Pick<
		StepSummary,
		"id" | "startedAt" | "endedAt" | "gate" | "scope"
	>[],
	start: number,
	now: number,
): RunTime {
	const going = steps.some((step) => step.endedAt === null);
	const end = going
		? now
		: Math.max(start, ...steps.map((step) => step.endedAt ?? 0));
	const parents = new Set(steps.map((step) => step.scope?.parentStepId));
	const gates: Span[] = [];
	const busy: Span[] = [];
	for (const step of steps) {
		const stepEnd = step.endedAt ?? end;
		if (step.gate) gates.push([step.gate.openedAt, stepEnd]);
		else if (!parents.has(step.id)) busy.push([step.startedAt, stepEnd]);
	}
	const points = [...new Set([...gates, ...busy].flat())]
		.map((point) => Math.min(Math.max(point, start), end))
		.sort((a, b) => a - b);
	const covers = (spans: Span[], at: number) =>
		spans.some(([from, to]) => from <= at && at < to);
	let waited = 0;
	for (let i = 1; i < points.length; i++) {
		const from = points[i - 1] as number;
		const to = points[i] as number;
		if (covers(gates, from) && !covers(busy, from)) waited += to - from;
	}
	const open = end - start;
	return { open, waited, active: open - waited, going };
}
