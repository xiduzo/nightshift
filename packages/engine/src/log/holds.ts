import type { HoldSection, Scope } from "./events";
import { scopeKey } from "./events";

/**
 * What a run holds for a scope (ADR 7), as its log says: a lease, and
 * later a service (ADR 9). The scope is the run, or a Section of the flow
 * the node is in (`section`). The fold of the run state keeps them
 * (`RunState.holds`), and the engine lets go of them when the run leaves
 * the scope (`leavingHolds`) and when it ends.
 */
export type Hold = {
	kind: "lease";
	/** The lease's name. */
	name: string;
	/** The node that took it. */
	nodeId: string;
	/** The scope of the flow the node is in. Null at the top level. */
	scope: Scope | null;
	/** The Section it holds for. Null: the run. */
	section: HoldSection | null;
	ttlMinutes: number;
	/** When it was taken. */
	at: number;
};

/** A step that routes on: what it ended in, and the edges it takes. */
export type ScopeExit = {
	/** The step that ended: a Call step's end ends the scopes of its flow. */
	stepId: string;
	/** The scope of the flow the step is in. */
	scope: Scope | null;
	edges: readonly { from: string; to: string }[];
};

/**
 * The holds a step leaves when it routes on. A hold for a Section leaves
 * when an edge in its flow goes from inside the Section to outside, or
 * when the Call step whose flow it was taken in ends. With parallel
 * branches, the first branch that leaves the Section lets go. A hold for
 * the run never leaves before the run ends.
 */
export function leavingHolds(holds: readonly Hold[], exit: ScopeExit): Hold[] {
	const key = scopeKey(exit.scope);
	return holds.filter((hold) => {
		if (hold.section === null) return false;
		if (hold.scope?.parentStepId === exit.stepId) return true;
		if (scopeKey(hold.scope) !== key) return false;
		const inside = new Set(hold.section.nodes);
		return exit.edges.some(
			(edge) => inside.has(edge.from) && !inside.has(edge.to),
		);
	});
}

/**
 * Whether a run that goes on at `nodeId` in `scope` is inside the hold's
 * scope: always for the run, else when the node, or a Call step that
 * holds it, is in the hold's Section. `parentOf` gives the node and scope
 * of a Call step.
 */
export function holdCovers(
	hold: Hold,
	at: { nodeId: string; scope: Scope | null },
	parentOf: (stepId: string) => { nodeId: string; scope: Scope | null } | null,
): boolean {
	if (hold.section === null) return true;
	const key = scopeKey(hold.scope);
	const seen = new Set<string>();
	for (
		let here: { nodeId: string; scope: Scope | null } | null = at;
		here !== null;
	) {
		if (
			scopeKey(here.scope) === key &&
			hold.section.nodes.includes(here.nodeId)
		) {
			return true;
		}
		const parent = here.scope?.parentStepId;
		if (parent === undefined || seen.has(parent)) return false;
		seen.add(parent);
		here = parentOf(parent);
	}
	return false;
}
