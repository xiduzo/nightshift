import type { FlowVariableDef, VariableType } from "@nightshift/flows";

import type { RunDetail, StepSummary } from "./api-types";
import {
	calledFlowName,
	calledFlowOf,
	type ItemScope,
	itemsOf,
	type RunFlows,
	scopeKey,
} from "./run-steps";

/** One value a variable took: from the run's log, oldest first. */
export type VariableChange = RunDetail["variables"][number];

/** One variable of one flow in the run: its value now and every value it had. */
export type VariableRow = {
	name: string;
	/** From the flow's declaration; undefined when the run's copy of the flow lacks it. */
	type: VariableType | undefined;
	description: string | undefined;
	/** The change that set the value it has now. */
	last: VariableChange;
	/** Every value, oldest first. */
	history: VariableChange[];
};

/** The variables of one flow the run ran: the run's own flow, or one call of a flow. */
export type VariableGroup = {
	scope: ItemScope;
	key: string;
	rows: VariableRow[];
};

/**
 * The run's variables per flow it ran: the run's own flow first, then each
 * called flow in the order its first value came. Within a flow, the
 * variables keep the order the flow declares them in; one it does not
 * declare (an older copy) comes after, in the order its first value came.
 */
export function variableGroups(
	run: RunFlows & Pick<RunDetail, "variables">,
	steps: readonly StepSummary[],
): VariableGroup[] {
	const byScope = new Map<
		string,
		{ scope: ItemScope; changes: VariableChange[] }
	>();
	for (const change of run.variables) {
		const scope: ItemScope = change.scope
			? { parentStepId: change.scope.parentStepId, itemId: change.scope.itemId }
			: null;
		const key = scopeKey(scope);
		let group = byScope.get(key);
		if (!group) {
			group = { scope, changes: [] };
			byScope.set(key, group);
		}
		group.changes.push(change);
	}
	const groups = [...byScope.entries()].map(([key, { scope, changes }]) => ({
		scope,
		key,
		rows: rowsOf(changes, declaredIn(run, steps, scope)),
	}));
	// The run's own flow first; the rest keep the order their first value came.
	return [
		...groups.filter((group) => group.scope === null),
		...groups.filter((group) => group.scope !== null),
	];
}

/** The variables the flow of `scope` declares: the run's flow, or the called flow of its Call step. */
function declaredIn(
	run: RunFlows,
	steps: readonly StepSummary[],
	scope: ItemScope,
): readonly FlowVariableDef[] {
	if (scope === null) return run.flow.variables ?? [];
	const parent = steps.find((step) => step.id === scope.parentStepId);
	if (!parent) return [];
	return calledFlowOf(run, steps, parent)?.variables ?? [];
}

function rowsOf(
	changes: readonly VariableChange[],
	declared: readonly FlowVariableDef[],
): VariableRow[] {
	const histories = new Map<string, VariableChange[]>();
	for (const change of changes) {
		const history = histories.get(change.name) ?? [];
		history.push(change);
		histories.set(change.name, history);
	}
	const order = [
		...declared.map((def) => def.name).filter((name) => histories.has(name)),
		...[...histories.keys()].filter(
			(name) => !declared.some((def) => def.name === name),
		),
	];
	return order.flatMap((name) => {
		const history = histories.get(name) ?? [];
		const last = history.at(-1);
		if (!last) return [];
		const def = declared.find((one) => one.name === name);
		return [
			{
				name,
				type: def?.type,
				description: def?.description,
				last,
				history,
			},
		];
	});
}

/** What a call scope shows as its name: the Call step's node, the item, and the flow it called. */
export function scopeLabel(
	run: RunFlows,
	steps: readonly StepSummary[],
	scope: NonNullable<ItemScope>,
): { nodeId: string; item: string | null; flow: string | null } {
	const parent = steps.find((step) => step.id === scope.parentStepId);
	if (!parent) return { nodeId: "call", item: scope.itemId, flow: null };
	const item =
		scope.itemId === null
			? null
			: (itemsOf(parent, steps).find((one) => one.id === scope.itemId)?.title ??
				scope.itemId);
	return {
		nodeId: parent.nodeId,
		item,
		flow: calledFlowName(run, steps, parent) ?? null,
	};
}

/** A value on one line: text as it is, anything else as compact JSON, cut short. */
export function previewValue(value: unknown, max = 80): string {
	const text =
		typeof value === "string" ? value : (JSON.stringify(value) ?? "");
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
