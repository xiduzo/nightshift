import type { RunSummary, StepSummary } from "./types";

/** How long a run took: open from start to end, and how much of that it waited for a person or slept. */
export type RunTime = {
	/** From the run's start to the last step's end, or to now while a step runs. */
	open: number;
	/** The time a Gate was open and no other step ran. */
	waited: number;
	/** The time a step slept and no other step ran or waited for a person. */
	slept: number;
	/** `open` without `waited` and `slept`: the time the run worked. */
	active: number;
	/** A step still runs, waits or sleeps: the times grow with `now`. */
	going: boolean;
};

type Span = [number, number];

/** `[from, to]` without the parts that `holes` cover. `holes` are in order and do not overlap. */
function without([from, to]: Span, holes: Span[]): Span[] {
	const left: Span[] = [];
	let at = from;
	for (const [holeFrom, holeTo] of holes) {
		if (holeTo <= at || holeFrom >= to) continue;
		if (holeFrom > at) left.push([at, holeFrom]);
		at = Math.max(at, holeTo);
	}
	if (at < to) left.push([at, to]);
	return left;
}

/**
 * How long the run took, with the time it waited for a person at a Gate
 * and the time it slept set apart. A Gate that is open, or a step that
 * sleeps, while another step runs does not count: the run still works.
 * A Call step that called other steps does not count as working on its own.
 */
export function runTime(
	steps: readonly Pick<
		StepSummary,
		"id" | "startedAt" | "endedAt" | "gate" | "scope" | "sleeps"
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
	const sleeps: Span[] = [];
	const busy: Span[] = [];
	for (const step of steps) {
		const stepEnd = step.endedAt ?? end;
		const slept = (step.sleeps ?? []).map(
			({ from, to }): Span => [from, to ?? stepEnd],
		);
		sleeps.push(...slept);
		if (step.gate) gates.push([step.gate.openedAt, stepEnd]);
		else if (!parents.has(step.id)) {
			busy.push(...without([step.startedAt, stepEnd], slept));
		}
	}
	const points = [...new Set([...gates, ...sleeps, ...busy].flat())]
		.map((point) => Math.min(Math.max(point, start), end))
		.sort((a, b) => a - b);
	const covers = (spans: Span[], at: number) =>
		spans.some(([from, to]) => from <= at && at < to);
	let waited = 0;
	let slept = 0;
	for (let i = 1; i < points.length; i++) {
		const from = points[i - 1] as number;
		const to = points[i] as number;
		if (covers(busy, from)) continue;
		if (covers(gates, from)) waited += to - from;
		else if (covers(sleeps, from)) slept += to - from;
	}
	const open = end - start;
	return { open, waited, slept, active: open - waited - slept, going };
}

/**
 * How long a run on its way has worked by `now`, from its summary alone:
 * from its start, without the time a Gate waited for a person or a step slept.
 */
export function workedSoFar(
	run: Pick<RunSummary, "createdAt" | "gates" | "sleeps">,
	now: number,
): number {
	const idle = [
		...run.gates.map((gate): Span => [gate.openedAt, gate.closedAt ?? now]),
		...(run.sleeps ?? []).map((sleep): Span => [sleep.from, sleep.to ?? now]),
	].sort((a, b) => a[0] - b[0]);
	return without([run.createdAt, now], idle).reduce(
		(sum, [from, to]) => sum + to - from,
		0,
	);
}
