import { type Flow, type FlowNode, runsEach } from "@nightshift/flows";

import type { ItemSummary, StepSummary } from "@/lib/api-types";

/**
 * The steps of a run form a tree: the top-level flow's steps, and under each
 * Call step the steps of the flow it called (once, or per element for a
 * Call with `each`), which can call flows of their own. A scope names one
 * level of that tree.
 */

/**
 * One call of a flow: a Call step that ran once (`itemId` null) or one
 * element of a Call step with `each`. Null is the top-level flow.
 */
export type ItemScope = { parentStepId: string; itemId: string | null } | null;

/** What the run view needs of a run: its flow and the flows it can call. */
export type RunFlows = { flow: Flow; calledFlows: Record<string, Flow> };

export function scopeKey(scope: ItemScope): string {
	return scope ? `${scope.parentStepId}:${scope.itemId ?? ""}` : "";
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
			current = byId.get(current.scope.parentStepId);
		}
		return false;
	};
	return steps.filter(inside);
}

/**
 * The step that stands for `step` in `scope`: the step itself when it is
 * directly in the scope, else its calling ancestor that is. Undefined when
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
		current = current.scope ? byId.get(current.scope.parentStepId) : undefined;
	}
	return undefined;
}

/** The flow a step's node belongs to: the run's flow or a called flow. */
export function flowOfStep(
	run: RunFlows,
	steps: readonly StepSummary[],
	step: StepSummary,
): Flow | undefined {
	if (!step.scope) return run.flow;
	const parent = steps.find((other) => other.id === step.scope?.parentStepId);
	return parent ? calledFlowOf(run, steps, parent) : undefined;
}

/** The node a step visited, from the run's copies of its flows. */
export function nodeOfStep(
	run: RunFlows,
	steps: readonly StepSummary[],
	step: StepSummary,
): FlowNode | undefined {
	return flowOfStep(run, steps, step)?.nodes.find(
		(candidate) => candidate.id === step.nodeId,
	);
}

/** The name of the flow a Call step calls. */
export function calledFlowName(
	run: RunFlows,
	steps: readonly StepSummary[],
	parentStep: StepSummary,
): string | undefined {
	const node = nodeOfStep(run, steps, parentStep);
	return node?.type === "call" ? node.flow : undefined;
}

/**
 * Whether a Call step runs its flow once per item. From the run's copy of
 * the flow; a step whose node is not in it counts as per item when it
 * started items.
 */
export function stepRunsEach(
	run: RunFlows,
	steps: readonly StepSummary[],
	step: StepSummary,
): boolean {
	if (step.nodeType !== "call") return false;
	const node = nodeOfStep(run, steps, step);
	return node ? runsEach(node) : step.items.length > 0;
}

/** The flow a Call step calls, from the run's copies. */
export function calledFlowOf(
	run: RunFlows,
	steps: readonly StepSummary[],
	parentStep: StepSummary,
): Flow | undefined {
	const name = calledFlowName(run, steps, parentStep);
	return name === undefined ? undefined : run.calledFlows[name];
}

/** Whether a step calls a flow, so other steps nest under it. */
export function callsFlow(step: StepSummary): boolean {
	return step.nodeType === "call";
}

/**
 * The items of a Call step with `each`: its own list, plus any item that only shows
 * through the scope of a called step (a summary that lags the stream).
 */
export function itemsOf(
	step: StepSummary,
	steps: readonly StepSummary[],
): ItemSummary[] {
	const items = [...step.items];
	const known = new Set(items.map((item) => item.id));
	for (const other of steps) {
		const itemId = other.scope?.itemId;
		if (other.scope?.parentStepId !== step.id || itemId == null) continue;
		if (known.has(itemId)) continue;
		known.add(itemId);
		items.push({
			id: itemId,
			title: itemId,
			url: null,
			value: null,
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
 * the next, on the first step's outcome. The engine counts edges per run; a
 * called flow's own walk is derived here.
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
): { parentStep: StepSummary; itemId: string | null }[] {
	const chain: { parentStep: StepSummary; itemId: string | null }[] = [];
	let current = scope;
	while (current) {
		const parentStep = steps.find((step) => step.id === current?.parentStepId);
		if (!parentStep) break;
		chain.unshift({ parentStep, itemId: current.itemId });
		current = parentStep.scope;
	}
	return chain;
}

/** A JSON value as text to read: strings as they are, the rest pretty-printed. */
export function formatJson(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined) return "";
	return JSON.stringify(value, null, 2);
}

/**
 * An output value that may hold JSON as text (an Agent's `data`, a Call's
 * `results`, a called flow's output): the parsed value when it is a JSON
 * object or array, else undefined.
 */
export function jsonOutput(value: unknown): unknown {
	if (typeof value === "object" && value !== null) return value;
	if (typeof value !== "string") return undefined;
	const text = value.trim();
	if (!(text.startsWith("{") || text.startsWith("["))) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}
