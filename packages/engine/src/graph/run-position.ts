import type { FlowNode } from "@nightshift/flows";
import {
	type EnginePayloads,
	type LoggedEvent,
	type Scope,
	scopeKey,
} from "../log";
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
 * The log is at most one super-step ahead of the checkpoint. A step can end
 * in the log and the commit after it not land: the daemon died, a stop
 * fenced the drive off, or the engine failed in between. Such a step is
 * done (`Position.done`): the node goes on from its logged end and runs
 * nothing again.
 *
 * This module is the one owner of that rule (design rule 5):
 *
 * - The commit: every node that ends a step, or keeps it open across
 *   super-steps (a wait, the elements of a Call with `each`), commits its
 *   visit through `commitVisit`. Nothing else writes `visits`.
 * - Where a node is (`positionOf`): the step a wait, a park or a Gate holds
 *   for it (`pending`), a loop that is mid-way (`loops`) and a loop cursor
 *   behind the log, the step the log has and the checkpoint never
 *   committed, a step that is done, and the visit a new step gets. The
 *   resume point (`resume-point.ts`) decides from these; the step runner
 *   numbers a new step from them.
 * - The front of the walk in the log (`frontOf`, `latestFront`,
 *   `reenteredNode`): the last step, and whether the walk moved on from
 *   it.
 * - The re-entry seed (`loggedVisits`, `takeBackVisit`): the visits a
 *   re-entry writes so that exactly the step it means is left uncommitted.
 * - A stale hold (`holdEnded`): a wait or a Gate the checkpoint holds whose
 *   step a stop ended in the log.
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
 * A step that ended before its work was done: a stop, an error (also a
 * step past its time limits), or a daemon death. Its node takes it up
 * again by its rules; a step that ended on its own is never taken up.
 */
export function isCutShort(step: Pick<DerivedStep, "outcome">): boolean {
	return (
		step.outcome === "stopped" ||
		step.outcome === "error" ||
		step.outcome === "interrupted"
	);
}

/**
 * A step that ended on its own, after the last commit of its node: the
 * walk is past it in the log, and the checkpoint does not know.
 */
export type DoneStep = {
	step: DerivedStep;
	/** Its `StepEnded`: the outcome, the outputs, the error and the variables. */
	ended: EnginePayloads["StepEnded"];
	/** The edge the walk took after it, when the log has one. */
	edge: EnginePayloads["EdgeTaken"] | null;
};

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
	/**
	 * The step of `node` that is done though the checkpoint holds it open
	 * or never committed it: it ended on its own (`isCutShort` is false)
	 * after the last commit. The step the checkpoint names is its held
	 * wait, its loop, or its uncommitted step. Not a parked step: the
	 * checkpoint saw that end. Not the last step of a run that finished: a
	 * resume reopens that one on purpose (`takeBackVisit`).
	 */
	done(node: NodeRef): DoneStep | null;
	/**
	 * The index of the last element of the node's loop that ended in the
	 * log, when the checkpoint's cursor (`loops`) is behind it: the commit
	 * after that element never landed. Null when the cursor agrees.
	 */
	cursorBehind(node: NodeRef): number | null;
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
	const byId = (stepId: string | null) =>
		stepId ? (steps().find((s) => s.id === stepId) ?? null) : null;
	const looping = (node: NodeRef) => Boolean(state.loops?.[node.id]);
	const uncommitted = (node: NodeRef) => {
		const logged = countVisits(events, node.id, key);
		if (logged <= (state.visits?.[node.id] ?? 0)) return null;
		return latest(node);
	};
	return {
		held(node) {
			const pending = heldStep(state, node.id);
			return pending ? { pending, step: byId(pending.stepId) } : null;
		},
		looping,
		latest,
		uncommitted,
		done(node) {
			const pending = heldStep(state, node.id);
			if (pending && pending.kind !== "wait") return null;
			const step = pending
				? byId(pending.stepId)
				: looping(node)
					? latest(node)
					: uncommitted(node);
			if (!step || step.endedAt === null || isCutShort(step)) return null;
			return doneAfter(events, step, key);
		},
		cursorBehind(node) {
			let last = 0;
			for (const item of latest(node)?.items ?? []) {
				if (!item.open && item.index !== null) {
					last = Math.max(last, item.index);
				}
			}
			const cursor = state.loops?.[node.id]?.index ?? 0;
			return last > cursor ? last : null;
		},
		nextVisit: (node) => countVisits(events, node.id, key) + 1,
	};
}

/**
 * The step's own end and the edge after it, unless the run finished after
 * that end. `key` is the step's scope.
 */
function doneAfter(
	events: readonly LoggedEvent[],
	step: DerivedStep,
	key: string,
): DoneStep | null {
	const ended = events.find(
		(e) =>
			e.type === "StepEnded" && e.stepId === step.id && e.seq > step.openedSeq,
	);
	if (ended?.type !== "StepEnded") return null;
	const finished = events.some(
		(e) =>
			e.type === "RunEnded" &&
			e.payload.status === "finished" &&
			e.seq > ended.seq,
	);
	if (finished) return null;
	const edge = events.find(
		(e): e is EdgeTakenEvent =>
			e.type === "EdgeTaken" &&
			e.seq > ended.seq &&
			e.payload.from === step.nodeId &&
			scopeKey(e.payload.scope ?? null) === key,
	);
	return { step, ended: ended.payload, edge: edge?.payload ?? null };
}

/**
 * Whether `step` ended on its own and the run did not finish after it: a
 * re-entry goes on from its end, and no harness session continues it.
 */
export function isDone(
	events: readonly LoggedEvent[],
	step: DerivedStep,
): boolean {
	if (step.endedAt === null || isCutShort(step)) return false;
	return doneAfter(events, step, scopeKey(step.scope)) !== null;
}

/** The step the checkpoint holds for `nodeId`, or null when it holds another node's, or none. */
export function heldStep(
	state: Partial<Pick<RunStateValues, "pending">>,
	nodeId: string,
): Pending | null {
	const pending = state.pending ?? null;
	return pending?.nodeId === nodeId ? pending : null;
}

/**
 * Whether the log ended the step a wait or a Gate holds: a stop ended it
 * after the hold was written. Such a hold is stale: no wake and no answer
 * comes for it.
 */
export function holdEnded(
	events: readonly LoggedEvent[],
	pending: Pending,
): boolean {
	if (pending.kind === "parked" || pending.stepId === null) return false;
	const step = deriveSteps(events).find((s) => s.id === pending.stepId);
	return step !== undefined && step.endedAt !== null;
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
