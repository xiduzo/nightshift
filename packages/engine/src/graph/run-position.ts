import type { FlowNode } from "@nightshift/flows";
import { type LoggedEvent, type Scope, scopeKey } from "../log";
import { countVisits, type DerivedStep, deriveSteps } from "../read";
import type { Pending, RunStateUpdate, RunStateValues } from "./state";

/**
 * The run position: where a run is, as its checkpoint and its log agree.
 *
 * The checkpoint and the log both say where a run is, and one rule keeps
 * them in agreement. The checkpoint counts the visits of each node it
 * committed (`visits`). The log counts every step the node started. When
 * the log counts one more, the node's latest step did not commit: a step
 * that runs, a Gate that is open, the step of a daemon that died, or a step
 * a re-entry left uncommitted on purpose so that the node takes it up.
 *
 * This module is the one owner of that rule (design rule 5):
 *
 * - The commit: every node that ends a step, or keeps it open across
 *   super-steps (a wait, the elements of a Call with `each`), commits its
 *   visit through `commitVisit`. Nothing else writes `visits`.
 * - Where a node is (`positionOf`): the step a wait, a park or a Gate holds
 *   for it (`pending`), a loop that is mid-way (`loops`), the step the log
 *   has and the checkpoint never committed, and the visit a new step gets.
 *   The resume point (`resume-point.ts`) decides from these; the step
 *   runner numbers a new step from them.
 * - The front of the walk in the log (`frontOf`, `latestFront`,
 *   `reenteredNode`): the last step, and whether the walk moved on from
 *   it.
 * - The re-entry seed (`loggedVisits`, `takeBackVisit`): the visits a
 *   re-entry writes so that exactly the step it means is left uncommitted.
 *
 * The checkpoint is the walk's, the log is the read model (ADR "The walk
 * reads the checkpoint; the event log is the read model"). This module
 * changes neither: it is the one place where the two are compared.
 *
 * One branch today. The shapes are keyed by node in one scope, `pending`
 * is one slot per graph, and the front is one last step per scope. A walk
 * with parallel branches keys them per branch here (docs/steering/
 * langgraph-engine.md, "Fan-out and join").
 */

type NodeRef = Pick<FlowNode, "id">;
type EdgeTakenEvent = Extract<LoggedEvent, { type: "EdgeTaken" }>;

/**
 * Commits the node's visit: the checkpoint counts the step, so no re-entry
 * takes it up as uncommitted. A node commits when its step ended (`route`,
 * every park after a step), when its step sleeps (`sleep`), and after each
 * element of a Call with `each`. A Gate does not commit while it is open:
 * its answer ends the step and commits it.
 */
export function commitVisit(
	node: NodeRef,
	visit: number,
): Pick<RunStateUpdate, "visits"> {
	return { visits: { [node.id]: visit } };
}

/** What the checkpoint holds for a node, and the step as the log has it. */
export type Held = {
	pending: Pending;
	/** The step `pending` names, from the log. Null when it has none, or the log has no such step. */
	step: DerivedStep | null;
};

/** Where a run is in one scope, for one node at a time. */
export type Position = {
	/** The step a wait, a park or a Gate holds for `node`, when it is that node's. */
	held(node: NodeRef): Held | null;
	/** True while `node` loops over elements: a Call with `each` mid-loop. */
	looping(node: NodeRef): boolean;
	/** The node's latest step in this scope, as the log has it. */
	latest(node: NodeRef): DerivedStep | null;
	/**
	 * The step of `node` the log has and the checkpoint never committed:
	 * the log counts more visits of the node in this scope than `visits`.
	 * Its latest step, else null.
	 */
	uncommitted(node: NodeRef): DerivedStep | null;
	/** The visit a new step of `node` gets: one more than the log counts in this scope. */
	nextVisit(node: NodeRef): number;
};

/**
 * Where the run is in `scope` (null: the top level), from the checkpoint's
 * `pending`, `loops` and `visits` and from the log. The log is derived once,
 * on the first question that needs it.
 */
export function positionOf(
	state: Partial<Pick<RunStateValues, "pending" | "loops" | "visits">>,
	events: readonly LoggedEvent[],
	scope: Scope | null,
): Position {
	const key = scopeKey(scope);
	let derived: DerivedStep[] | undefined;
	const steps = () => {
		derived ??= deriveSteps(events);
		return derived;
	};
	const latest = (node: NodeRef) =>
		steps().findLast(
			(s) => s.nodeId === node.id && scopeKey(s.scope) === key,
		) ?? null;
	return {
		held(node) {
			const pending = heldStep(state, node.id);
			if (!pending) return null;
			const stepId = pending.stepId;
			return {
				pending,
				step: stepId ? (steps().find((s) => s.id === stepId) ?? null) : null,
			};
		},
		looping: (node) => Boolean(state.loops?.[node.id]),
		latest,
		uncommitted(node) {
			const logged = countVisits(events, node.id, key);
			if (logged <= (state.visits?.[node.id] ?? 0)) return null;
			return latest(node);
		},
		nextVisit: (node) => countVisits(events, node.id, key) + 1,
	};
}

/** The step the checkpoint holds for `nodeId`, or null when it holds another node's, or none. */
export function heldStep(
	state: Partial<Pick<RunStateValues, "pending">>,
	nodeId: string,
): Pending | null {
	const pending = state.pending ?? null;
	return pending?.nodeId === nodeId ? pending : null;
}

/** The front of the walk: its last step, and the edge the walk took after that step started. */
export type Front = {
	last: DerivedStep | null;
	/** The latest `EdgeTaken` after `last` started: the walk moved on from it. */
	movedOn: EdgeTakenEvent | null;
};

/** The front of the walk in one scope (null: the top level). */
export function frontOf(
	events: readonly LoggedEvent[],
	scope: Scope | null,
): Front {
	return front(events, scopeKey(scope));
}

/**
 * The front of the walk over every scope: the last step anywhere, and an
 * edge taken anywhere after it. With one branch this is where the run is;
 * a walk with parallel branches has one front per branch.
 */
export function latestFront(events: readonly LoggedEvent[]): Front {
	return front(events, null);
}

function front(events: readonly LoggedEvent[], key: string | null): Front {
	const inScope = (scope: Scope | null | undefined) =>
		key === null || scopeKey(scope ?? null) === key;
	const last = deriveSteps(events).findLast((s) => inScope(s.scope)) ?? null;
	let lastEdge: EdgeTakenEvent | null = null;
	for (const e of events) {
		if (e.type !== "EdgeTaken" || !inScope(e.payload.scope)) continue;
		if (!lastEdge || e.seq > lastEdge.seq) lastEdge = e;
	}
	const movedOn =
		lastEdge && (!last || lastEdge.seq > last.startSeq) ? lastEdge : null;
	return { last, movedOn };
}

/**
 * The top-level node a re-entry reopens: the one of the last top-level
 * step, when the walk did not move on from it (no later top-level
 * `EdgeTaken`). A re-entry leaves its visit uncommitted on purpose
 * (`loggedVisits`, `takeBackVisit`), so the node finds the step with
 * `Position.uncommitted` and takes it up by its own rules: an Agent
 * continues its harness session with the resume prompt, a Call goes on
 * inside it. Null when the run moved on, or never started a step.
 */
export function reenteredNode(events: readonly LoggedEvent[]): string | null {
	const { last, movedOn } = frontOf(events, null);
	return last && !movedOn ? last.nodeId : null;
}

/**
 * The visits of every top-level node as the log counts them: every step of
 * the node is committed, so none is left for a re-entry to take up.
 * `reopen`'s last visit stays uncommitted (its count is one less). The seed
 * of a thread with no checkpoint, and of every rerun.
 */
export function loggedVisits(
	flow: { nodes: readonly NodeRef[] },
	events: readonly LoggedEvent[],
	reopen: string | null,
): Record<string, number> {
	const visits: Record<string, number> = {};
	for (const node of flow.nodes) {
		const count =
			countVisits(events, node.id, "") - (node.id === reopen ? 1 : 0);
		if (count > 0) visits[node.id] = count;
	}
	return visits;
}

/**
 * Takes the last visit of `nodeId` back from a checkpoint's `visits`, so
 * the node reopens that step when the thread jumps to it (a resume of a
 * run whose thread ended). Nothing when there is no node, or the
 * checkpoint committed none of its visits.
 */
export function takeBackVisit(
	values: Partial<Pick<RunStateValues, "visits">>,
	nodeId: string | null,
): Pick<RunStateUpdate, "visits"> {
	const committed = nodeId ? (values.visits?.[nodeId] ?? 0) : 0;
	return nodeId && committed > 0
		? commitVisit({ id: nodeId }, committed - 1)
		: {};
}
