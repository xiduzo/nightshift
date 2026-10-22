import type { Flow } from "@nightshift/flows";
import { type LoggedEvent, type Scope, scopeKey } from "../log";
import {
	countVisits,
	type DerivedStep,
	deriveInputs,
	deriveNodeOutputs,
	deriveSteps,
	deriveStopAt,
	deriveTraversals,
	deriveVariables,
} from "../read";
import { sessionOf } from "./resume-point";
import type { RunStateUpdate } from "./state";

/**
 * Re-entry: the daemon side of a resume. A person or the daemon asks a run
 * that is not going to continue, to restart its step, or to run again from
 * a node. This module says, from the log and where the thread is, what
 * `RunResumed` records and how the thread moves. The node side of the same
 * question is the resume point (`resume-point.ts`): what a node does with
 * its step when it re-enters. Both read `sessionOf`, so
 * what `RunResumed` promises is what the node finds.
 *
 * This module appends nothing and drives nothing: it only decides.
 */

type EdgeTakenEvent = Extract<LoggedEvent, { type: "EdgeTaken" }>;

/**
 * The front of the walk in a scope (`key`; null for every scope): the last
 * step, and the `EdgeTaken` after it started when the walk moved on from
 * it. Both `reenteredNode` and `resumeTarget` read the front, so they agree
 * on which step is left to take up.
 */
function walkFront(
	steps: readonly DerivedStep[],
	events: readonly LoggedEvent[],
	key: string | null,
): { last: DerivedStep | null; movedOn: EdgeTakenEvent | null } {
	const inScope = (scope: Scope | null | undefined) =>
		key === null || scopeKey(scope ?? null) === key;
	const last = steps.findLast((s) => inScope(s.scope)) ?? null;
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
 * `EdgeTaken`). Its visit is left uncommitted on purpose, so the node finds
 * the step with `uncommittedStep` and takes it up by its own rules: an
 * Agent continues its harness session with the resume prompt, a Call goes
 * on inside it. Null when the run moved on, or never started a step.
 */
export function reenteredNode(events: readonly LoggedEvent[]): string | null {
	const { last, movedOn } = walkFront(deriveSteps(events), events, "");
	return last && !movedOn ? last.nodeId : null;
}

/**
 * The state a thread without a checkpoint (a run from before this engine)
 * is re-entered with, from the log: the inputs and the stop time, the
 * committed visits of every top-level node, the node outputs for templates
 * and the edge counts. Without it every node with a step in the log looks
 * uncommitted (`uncommittedStep`), so a Call later in the flow would reopen
 * a finished step, `{{node.output}}` would render empty and edge `max`
 * counts would start over. Bodies get fresh namespaces and read their
 * scope from the log. The `reenteredNode`'s last visit stays uncommitted.
 */
export function reentryUpdate(
	flow: Flow,
	events: readonly LoggedEvent[],
	reentered: string | null = reenteredNode(events),
): RunStateUpdate {
	return {
		inputs: deriveInputs(events),
		stopAt: deriveStopAt(events),
		visits: loggedVisits(flow, events, reentered),
		nodes: deriveNodeOutputs(events, ""),
		vars: deriveVariables(events, ""),
		traversals: deriveTraversals(events, ""),
		ended: null,
		pending: null,
	};
}

/**
 * The committed visits of every top-level node, as the log counts them:
 * every step of the node ended or was taken over by the walk, so none is
 * left for `uncommittedStep` to take up. `reentered`'s last visit stays
 * uncommitted (its count is one less).
 */
export function loggedVisits(
	flow: Flow,
	events: readonly LoggedEvent[],
	reentered: string | null,
): Record<string, number> {
	const visits: Record<string, number> = {};
	for (const node of flow.nodes) {
		const count =
			countVisits(events, node.id, "") - (node.id === reentered ? 1 : 0);
		if (count > 0) visits[node.id] = count;
	}
	return visits;
}

/** What `RunResumed` records (`resumeTarget`). */
export type ResumeTarget = {
	nodeId: string;
	/** The Agent step whose harness session the resume continues, else null. */
	stepId: string | null;
	scope: Scope | null;
	/** The top-level node around `nodeId`, for a thread re-entered from the root. */
	topNodeId: string;
};

/**
 * What `RunResumed` records: the node the run continues at, from the log.
 * When the run took an edge after its last step started (it stopped or
 * died between steps), that edge's target; else the last step's node, with
 * its id when it is an Agent step with a harness session to continue (the
 * same session `resumePoint` takes up, `sessionOf`), and its scope. Null
 * when the run never started a step.
 */
export function resumeTarget(
	events: readonly LoggedEvent[],
): ResumeTarget | null {
	const steps = deriveSteps(events);
	const { last, movedOn } = walkFront(steps, events, null);
	let nodeId: string;
	let stepId: string | null = null;
	let scope: Scope | null;
	if (movedOn) {
		nodeId = movedOn.payload.to;
		scope = movedOn.payload.scope ?? null;
	} else if (last) {
		nodeId = last.nodeId;
		scope = last.scope;
		if (last.nodeType === "agent" && sessionOf(last) !== null) {
			stepId = last.id;
		}
	} else {
		return null;
	}
	const byId = new Map(steps.map((s) => [s.id, s]));
	let topNodeId = nodeId;
	for (let at = scope; at; ) {
		const caller = byId.get(at.parentStepId);
		if (!caller) break;
		topNodeId = caller.nodeId;
		at = caller.scope;
	}
	return { nodeId, stepId, scope, topNodeId };
}
