import type { Flow } from "@nightshift/flows";

import type { ItemSummary, StepSummary } from "@/lib/api-types";

/**
 * The steps of a run form a tree: the top-level flow's steps, and under each
 * For Each step, per item, the steps of its body flow (which can hold a For
 * Each of its own). A scope names one level of that tree.
 */

/** One item of one For Each step. Null is the top-level flow. */
export type ItemScope = { forEachStepId: string; itemId: string } | null;

export function scopeKey(scope: ItemScope): string {
	return scope ? `${scope.forEachStepId}:${scope.itemId}` : "";
}

export function sameScope(a: ItemScope, b: ItemScope): boolean {
	return scopeKey(a) === scopeKey(b);
}

/** The steps directly in one scope, in the order they started. */
export function stepsIn(
	steps: readonly StepSummary[],
	scope: ItemScope,
): StepSummary[] {
	const key = scopeKey(scope);
	return steps.filter((step) => scopeKey(step.scope) === key);
}

/** The steps in a scope and in the scopes nested under it. */
export function stepsUnder(
	steps: readonly StepSummary[],
	scope: ItemScope,
): StepSummary[] {
	if (!scope) return [...steps];
	const byId = new Map(steps.map((step) => [step.id, step]));
	const key = scopeKey(scope);
	const inside = (step: StepSummary): boolean => {
		let current: StepSummary | undefined = step;
		while (current?.scope) {
			if (scopeKey(current.scope) === key) return true;
			current = byId.get(current.scope.forEachStepId);
		}
		return false;
	};
	return steps.filter(inside);
}

/**
 * The step that stands for `step` in `scope`: the step itself when it is
 * directly in the scope, else its For Each ancestor that is. Undefined when
 * the step is not under the scope.
 */
export function stepAtScope(
	steps: readonly StepSummary[],
	step: StepSummary,
	scope: ItemScope,
): StepSummary | undefined {
	const byId = new Map(steps.map((candidate) => [candidate.id, candidate]));
	const key = scopeKey(scope);
	let current: StepSummary | undefined = step;
	while (current) {
		if (scopeKey(current.scope) === key) return current;
		current = current.scope ? byId.get(current.scope.forEachStepId) : undefined;
	}
	return undefined;
}

/** The flow a step's node belongs to: the run's flow or a body flow. */
export function flowOfStep(
	run: { flow: Flow; bodyFlows: Record<string, Flow> },
	steps: readonly StepSummary[],
	step: StepSummary,
): Flow | undefined {
	if (!step.scope) return run.flow;
	const parent = steps.find((other) => other.id === step.scope?.forEachStepId);
	return parent ? bodyFlowOf(run, steps, parent) : undefined;
}

/** The body flow a For Each step runs per item, from the run's copies. */
export function bodyFlowOf(
	run: { flow: Flow; bodyFlows: Record<string, Flow> },
	steps: readonly StepSummary[],
	forEachStep: StepSummary,
): Flow | undefined {
	const flow = flowOfStep(run, steps, forEachStep);
	const node = flow?.nodes.find(
		(candidate) => candidate.id === forEachStep.nodeId,
	);
	return node?.type === "foreach" ? run.bodyFlows[node.flow] : undefined;
}

/** The body flow's name for a For Each step, from the run's flows. */
export function bodyFlowName(
	run: { flow: Flow; bodyFlows: Record<string, Flow> },
	steps: readonly StepSummary[],
	forEachStep: StepSummary,
): string | undefined {
	const flow = flowOfStep(run, steps, forEachStep);
	const node = flow?.nodes.find(
		(candidate) => candidate.id === forEachStep.nodeId,
	);
	return node?.type === "foreach" ? node.flow : undefined;
}

/**
 * The items of a For Each step: its own list, plus any item that only shows
 * through the scope of a body step (a summary that lags the stream).
 */
export function itemsOf(
	step: StepSummary,
	steps: readonly StepSummary[],
): ItemSummary[] {
	const items = [...step.items];
	const known = new Set(items.map((item) => item.id));
	for (const other of steps) {
		if (other.scope?.forEachStepId !== step.id) continue;
		if (known.has(other.scope.itemId)) continue;
		known.add(other.scope.itemId);
		items.push({
			id: other.scope.itemId,
			number: null,
			title: other.scope.itemId,
			url: null,
			state: "running",
			branch: null,
			baseBranch: null,
			startedAt: other.startedAt,
			endedAt: null,
			reason: null,
		});
	}
	return items;
}

/**
 * How often the steps of one scope took each edge of its flow: one step to
 * the next, on the first step's outcome. The engine counts edges per run; an
 * item's own walk is derived here.
 */
export function derivedTraversals(
	flow: Flow,
	steps: readonly StepSummary[],
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (let index = 1; index < steps.length; index++) {
		const from = steps[index - 1];
		const to = steps[index];
		if (!from || !to || from.outcome === null) continue;
		const edge = flow.edges.find(
			(candidate) =>
				candidate.from === from.nodeId &&
				candidate.outcome === from.outcome &&
				candidate.to === to.nodeId,
		);
		if (edge) counts[edge.id] = (counts[edge.id] ?? 0) + 1;
	}
	return counts;
}

/** The chain of scopes from the top down to `scope`, top first, `scope` last. */
export function scopeChain(
	steps: readonly StepSummary[],
	scope: ItemScope,
): { forEachStep: StepSummary; itemId: string }[] {
	const chain: { forEachStep: StepSummary; itemId: string }[] = [];
	let current = scope;
	while (current) {
		const forEachStep = steps.find(
			(step) => step.id === current?.forEachStepId,
		);
		if (!forEachStep) break;
		chain.unshift({ forEachStep, itemId: current.itemId });
		current = forEachStep.scope;
	}
	return chain;
}
