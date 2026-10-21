import type { StepSummary } from "./types";

/**
 * The run's steps: the fetched list, with the live summaries from the stream
 * laid over it, in the order they started.
 */
export function mergeSteps(
	fetched: readonly StepSummary[],
	live: ReadonlyMap<string, StepSummary>,
): StepSummary[] {
	const byId = new Map(fetched.map((step) => [step.id, step]));
	for (const [id, step] of live) byId.set(id, step);
	return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
}
