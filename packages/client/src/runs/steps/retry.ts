import type { StepSummary } from "../types";

type Step = Pick<StepSummary, "id" | "nodeId" | "endedAt" | "scope">;

/** How a step ended that a resume of its run takes up. Any other step is done. */
const TAKEN_UP: ReadonlySet<string> = new Set([
	"stopped",
	"error",
	"interrupted",
	"fail",
	"needs-input",
]);

/**
 * The step a resume continues at, which gets the prompt. It is the last
 * step that started. Parallel branches can leave it done, or no Agent:
 * then it is the last one that a branch beside it waits with, an Agent
 * first. `steps` are in the order they started.
 */
export function resumedStep<
	T extends Pick<StepSummary, "nodeType" | "outcome" | "startedAt" | "endedAt">,
>(steps: readonly T[]): T | undefined {
	const last = steps.at(-1);
	if (!last) return undefined;
	const beside = steps.filter(
		(step) =>
			step.outcome !== null &&
			TAKEN_UP.has(step.outcome) &&
			step.endedAt !== null &&
			step.endedAt >= last.startedAt,
	);
	return (
		beside.filter((step) => step.nodeType === "agent").at(-1) ??
		beside.at(-1) ??
		last
	);
}

/**
 * The step a restart starts again: the innermost step that runs. A step
 * inside a called flow starts after its caller, so the last one counts.
 * None when no step runs.
 */
export function runningStep<T extends Step>(
	steps: readonly T[],
): T | undefined {
	for (let i = steps.length - 1; i >= 0; i--) {
		const step = steps[i];
		if (step && step.endedAt === null) return step;
	}
	return undefined;
}

/** Where a run can run again from: the start of its flow, or the step it got to. */
export type RerunStart<T extends Step = Step> = {
	from: "start" | "last";
	step: T;
};

/**
 * The places a run that ended can run again from, as the phone offers
 * them: its first step and its last, in the order the steps started. A
 * step inside a called flow is no start: only the run's own steps count.
 * One place when the first step is the last node too.
 */
export function rerunStarts<T extends Step>(
	steps: readonly T[],
): RerunStart<T>[] {
	const own = steps.filter((step) => step.scope === null);
	const first = own[0];
	const last = own.at(-1);
	if (!first || !last) return [];
	if (first.nodeId === last.nodeId) return [{ from: "last", step: last }];
	return [
		{ from: "start", step: first },
		{ from: "last", step: last },
	];
}
