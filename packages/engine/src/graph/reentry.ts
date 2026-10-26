import type { Flow } from "@nightshift/flows";
import type {
	EnginePayloads,
	LoggedEvent,
	ResumedBy,
	RunResult,
	RunStatus,
	Scope,
} from "../log";
import {
	deriveInputs,
	deriveNodeOutputs,
	deriveRunState,
	deriveSteps,
	deriveStopAt,
	deriveTraversals,
	deriveVariables,
} from "../read";
import { RunRefusal, refuseUnless } from "../run-status";
import { DEFAULT_RESUME_PROMPT } from "./context";
import { sessionOf } from "./resume-point";
import {
	isDone,
	latestFront,
	loggedVisits,
	positionOf,
	reenteredNode,
	takeBackVisit,
} from "./run-position";
import type { RunStateUpdate } from "./state";
import type { ThreadEntry, ThreadSnapshot } from "./thread";

/**
 * Re-entry: the daemon side of a resume. A person or the daemon asks a run
 * that is not going to continue, to restart its step, or to run again from
 * a node. `planReentry` says, from the log and the thread's latest
 * checkpoint, what `RunResumed` records and how the thread moves: one call
 * gives both, so the node finds what the log promises. The node side of
 * the same question is the resume point (`resume-point.ts`): what a node
 * does with its step when it re-enters. Both read `sessionOf`, and where
 * the run is (the front of the walk, the visits a re-entry seeds) comes
 * from the run position (`run-position.ts`).
 *
 * The runner's re-entry Turn appends the plan's `RunResumed` and drives
 * its entry (`runner.ts`). This module appends nothing and drives nothing:
 * it only decides. Its table test (`reentry.test.ts`) also checks each
 * plan against the resume point.
 */

/**
 * The state a thread without a checkpoint (a run from before this engine)
 * is re-entered with, from the log: the inputs and the stop time, the
 * committed visits of every top-level node (`loggedVisits`), the node
 * outputs for templates and the edge counts. Without it every node with a
 * step in the log looks uncommitted (`Position.uncommitted`), so a Call
 * later in the flow would reopen
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
	const { last, movedOn } = latestFront(events);
	let nodeId: string;
	let stepId: string | null = null;
	let scope: Scope | null;
	if (movedOn) {
		nodeId = movedOn.payload.to;
		scope = movedOn.payload.scope ?? null;
	} else if (last) {
		nodeId = last.nodeId;
		scope = last.scope;
		// A step that is done goes on from its end: no session continues.
		if (
			last.nodeType === "agent" &&
			sessionOf(last) !== null &&
			!isDone(events, last)
		) {
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

/** The follow-up prompt of an Agent session that the daemon continues after a restart. */
export const DAEMON_RESUME_PROMPT =
	"Night Shift stopped while you worked on this, so your last actions may or may not have happened. Before you repeat any of them, check the worktree (git status, git log) and the remote (pushed branches, pull requests, comments). Then continue where you left off.";
/** Why the daemon resumed a run (`RunResumed.reason`). */
export const DAEMON_RESUME_REASON = "Night Shift restarted.";

/** What a person or the daemon asks of a run that is not going. */
export type ReentryRequest =
	/** Continue the run where it is. `restart`: its running step was stopped for this (`restartStep`). */
	| { kind: "resume"; by: ResumedBy; prompt?: string; action?: "restart" }
	/**
	 * Walk the run again from `nodeId`, a top-level node. An Agent node
	 * continues the session of `stepId` (default: the node's latest
	 * top-level step) with `prompt`, unless `fresh`.
	 */
	| {
			kind: "rerun";
			by: ResumedBy;
			nodeId: string;
			stepId?: string;
			prompt?: string;
			fresh?: boolean;
	  };

/** What `RunResumed` records, and how the thread moves. */
export type ReentryPlan = {
	resumed: EnginePayloads["RunResumed"];
	entry: ThreadEntry;
	/** Drop the task the thread still has (an interrupt, or a node cut short) first, so only the jump runs. */
	clearTasks: boolean;
};

/** Why a rerun from `nodeId` is refused before anything else: the run's own flow has no such node. Null when it has. */
export function rerunNodeRefusal(flow: Flow, nodeId: string): string | null {
	return flow.nodes.some((n) => n.id === nodeId)
		? null
		: `This run's flow has no node "${nodeId}". Pick a step of the run's own flow, not one inside a called flow.`;
}

/**
 * Pure: what a re-entry records and how the thread moves. Throws a
 * `RunRefusal` when the run refuses the request: it runs, waits or sleeps
 * (the run's own rule, `run-status/`); a rerun node is not a top-level node
 * of the flow; a rerun step is not a step of that node.
 *
 * A resume continues where the thread is (design rule 9):
 *
 * - at a wait or a parked step: the interrupt is answered with
 *   `{ kind: "resume", prompt }`; at a Gate (the run stopped there) with
 *   `{ kind: "reopen" }`, and the Gate asks again;
 * - a node pending without an interrupt (the daemon died, or the engine
 *   failed, while it ran): that node runs again (rule 5);
 * - a thread that ended or never ran: a jump to the top-level node the log
 *   points at (`resumeTarget`). A finished run re-enters on its own latest
 *   checkpoint, with the `reenteredNode`'s last visit taken back so the
 *   node reopens its step; a thread with no checkpoint (a run from before
 *   this engine) is seeded from the log (`reentryUpdate`).
 *
 * A rerun always jumps to its node, with the visits set to the log's
 * counts (`loggedVisits`: no step of an earlier walk is taken up again) and
 * the cursors of Calls with `each` cleared (a Call starts its list over).
 * Inputs, node outputs and edge counts stay.
 *
 * Either way, a resume past the stop time clears it: in the log
 * (`clearStopAt`) and in the thread's state before the node goes on.
 */
export function planReentry(input: {
	flow: Flow;
	events: readonly LoggedEvent[];
	thread: ThreadSnapshot;
	request: ReentryRequest;
	now: number;
}): ReentryPlan {
	const { flow, events, thread, request } = input;
	const stopAt = deriveStopAt(events);
	const clearStopAt = stopAt !== null && input.now >= stopAt;
	const cleared: RunStateUpdate | undefined = clearStopAt
		? { stopAt: null }
		: undefined;
	if (request.kind === "rerun") {
		const refusal = rerunNodeRefusal(flow, request.nodeId);
		if (refusal) throw new RunRefusal("unknown-node", refusal);
	}
	const { status, result } = deriveRunState(events);
	refuseLive(request.kind, status, result);
	if (request.kind === "rerun") {
		return planRerun(flow, events, thread, request, clearStopAt, cleared);
	}
	const target = resumeTarget(events) ?? {
		nodeId: flow.start,
		stepId: null,
		scope: null,
		topNodeId: flow.start,
	};
	const prompt =
		request.prompt ??
		(request.by === "daemon" ? DAEMON_RESUME_PROMPT : DEFAULT_RESUME_PROMPT);
	const resumed: EnginePayloads["RunResumed"] = {
		nodeId: target.nodeId,
		stepId: target.stepId,
		prompt: target.stepId ? prompt : null,
		scope: target.scope,
		...(clearStopAt ? { clearStopAt: true } : {}),
		by: request.by,
		...(request.by === "daemon" ? { reason: DAEMON_RESUME_REASON } : {}),
		...(request.action ? { action: request.action } : {}),
	};
	const update = cleared ? { update: cleared } : {};
	switch (thread.state.kind) {
		case "interrupted":
			return {
				resumed,
				entry: {
					kind: "resume",
					value:
						thread.state.value.kind === "gate"
							? { kind: "reopen" }
							: { kind: "resume", prompt },
					...update,
				},
				clearTasks: false,
			};
		case "pending":
			return {
				resumed,
				entry: { kind: "continue", ...update },
				clearTasks: false,
			};
		case "ended":
		case "fresh":
			return {
				resumed,
				entry: {
					kind: "goto",
					nodeId: target.topNodeId,
					update: { ...reenteredSeed(flow, events, thread), ...cleared },
				},
				clearTasks: false,
			};
	}
}

/** The state a resume of a thread that ended or never ran jumps in with. */
function reenteredSeed(
	flow: Flow,
	events: readonly LoggedEvent[],
	thread: ThreadSnapshot,
): RunStateUpdate {
	if (!thread.hasCheckpoint) return reentryUpdate(flow, events);
	return {
		ended: null,
		pending: null,
		...takeBackVisit(thread.values, reenteredNode(events)),
	};
}

function planRerun(
	flow: Flow,
	events: readonly LoggedEvent[],
	thread: ThreadSnapshot,
	request: Extract<ReentryRequest, { kind: "rerun" }>,
	clearStopAt: boolean,
	cleared: RunStateUpdate | undefined,
): ReentryPlan {
	const { nodeId } = request;
	const last =
		request.stepId === undefined
			? positionOf(thread.values, events, null).latest({ id: nodeId })
			: deriveSteps(events).find((s) => s.id === request.stepId);
	if (
		request.stepId !== undefined &&
		(last?.nodeId !== nodeId || last.scope !== null)
	) {
		throw new RunRefusal(
			"unknown-step",
			`That step is not a step of "${nodeId}" in the run's own flow.`,
		);
	}
	const continued =
		!request.fresh && last?.nodeType === "agent" && sessionOf(last) !== null
			? last
			: null;
	const seed: RunStateUpdate = thread.hasCheckpoint
		? {
				ended: null,
				pending: null,
				visits: loggedVisits(flow, events, null),
				loops: Object.fromEntries(
					Object.keys(thread.values.loops ?? {}).map((id) => [id, null]),
				),
			}
		: reentryUpdate(flow, events, null);
	return {
		resumed: {
			nodeId,
			stepId: continued?.id ?? null,
			prompt: continued ? (request.prompt ?? DEFAULT_RESUME_PROMPT) : null,
			scope: null,
			...(clearStopAt ? { clearStopAt: true } : {}),
			by: request.by,
			action: "rerun",
		},
		entry: { kind: "goto", nodeId, update: { ...seed, ...cleared } },
		clearTasks: thread.hasCheckpoint && thread.hasTasks,
	};
}

/**
 * Throws for a run that is still going: it must stop first. The refusal
 * is the run's own rule (`run-status/`). A resume of a sleeping run is a
 * wake, which the runner takes before it gets here.
 */
function refuseLive(
	kind: ReentryRequest["kind"],
	status: RunStatus,
	result: RunResult | null,
): void {
	refuseUnless(kind, status, true, result);
	if (status === "sleeping") {
		throw new Error("A sleeping run wakes. It does not re-enter.");
	}
}
