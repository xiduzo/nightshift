import type { Database } from "@nightshift/db";
import type { Flow, FlowNode } from "@nightshift/flows";
import {
	type DerivedSession,
	type DerivedStep,
	type EnginePayloads,
	getRunRow,
	type RunBus,
	type RunLog,
	type RunRow,
	type RunState,
	type StepOutputs,
} from "../log";
import {
	deriveRunState,
	deriveSteps,
	isOpenStatus,
	parkedSteps,
	withEnclosing,
} from "../read";
import { type CutShortOutcome, type NodeKind, PLAIN_KIND } from "./context";
import type { Overdue } from "./deadlines";
import { letGo, type RunHolds } from "./holds";
import { NODE_KINDS } from "./node-kinds";

/**
 * Open work that is cut short: one module ends the sessions, steps and run
 * that did not end on their own. Three things cut work short: a person
 * stops the run (or restarts its running step), a step runs past its time
 * limits and its timer did not end it, or the daemon that walked the run
 * died. Before this module the stop and the deadline ended the work in the
 * runner and the daemon death in recovery, each with its own payloads, its
 * own order and its own outputs. Now `closingEvents` is the one rule for
 * how a cut-short step ends, and both callers append what it gives.
 *
 * - Sessions end first, then steps from the inside out (a step inside a
 *   Call before the Call), then the run.
 * - A step ends with its kind's outputs (`NodeKind.cutShortOutputs`), so
 *   `nodes.<id>.*` holds the same fields after any cut.
 * - The thread stays where it is: a resume re-enters it (design rule 7).
 *
 * The normal end of a step (`OpenStep.end` in the step runner) is not here:
 * it runs inside the drive, applies variable writes, records cost and
 * routes. A cut does none of that.
 */

/** Why a run's open work ends before its drive ended it. */
export type CutShort =
	/** A person stopped the run, or restarted its running step. */
	| { kind: "stopped" }
	/** A step ran past its time budget or idle limit, and its timer did not end it. */
	| ({ kind: "overdue" } & Overdue)
	/** The daemon that walked the run died. `reason` is the run's end reason, when the run ran. */
	| { kind: "interrupted"; reason: string };

/** What a cut ends, from the log. */
export type OpenWork = {
	/** Sessions that started and did not end. */
	sessions: DerivedSession[];
	/**
	 * Steps that started and did not end, innermost first. An interrupt
	 * keeps a parked step (an open Gate, a sleep) and its calling steps
	 * open: they wait for a person or a timer, and are not lost work.
	 */
	steps: DerivedStep[];
	/** Whether the cut also ends the run: an open run for a stop or a deadline, a running one for an interrupt. */
	endsRun: boolean;
};

/** What a `cut` of the run's work ends, from the log. */
export function openWork(runState: RunState, cut: CutShort["kind"]): OpenWork {
	const parked = new Set(
		cut === "interrupted" ? parkedSteps(runState).map((s) => s.id) : [],
	);
	const status = deriveRunState(runState).status;
	return {
		sessions: [...runState.sessions.values()].filter((s) => s.ending === null),
		steps: deriveSteps(runState)
			.filter((s) => s.endedAt === null && !parked.has(s.id))
			.sort((a, b) => b.startSeq - a.startSeq),
		endsRun:
			cut === "interrupted" ? status === "running" : isOpenStatus(status),
	};
}

/** One event a cut appends, without its run id. */
export type ClosingEvent =
	| {
			type: "SessionEnded";
			stepId: string | null;
			sessionId: string;
			payload: EnginePayloads["SessionEnded"];
	  }
	| {
			type: "StepEnded";
			stepId: string;
			payload: EnginePayloads["StepEnded"];
	  }
	| {
			type: "RunWarned";
			stepId: string;
			payload: EnginePayloads["RunWarned"];
	  }
	| { type: "RunEnded"; payload: EnginePayloads["RunEnded"] };

/** The run's flow snapshot and the flows its Call nodes call. */
export type RunFlows = { flow: Flow; called: Record<string, Flow> };

/** How each cut ends a session, a step and the run. */
const CUTS = {
	stopped: {
		session: {
			outcome: "stopped",
			error: "The step was stopped.",
			errorKind: "aborted",
		},
		step: "stopped",
		run: "stopped",
	},
	overdue: {
		// As the step's timer ends its session: the abort fails it.
		session: {
			outcome: "failed",
			error: "The step was stopped.",
			errorKind: "aborted",
		},
		step: "error",
		run: "failed",
	},
	interrupted: {
		session: {
			outcome: "interrupted",
			error: "Night Shift stopped while this ran.",
			errorKind: null,
		},
		step: "interrupted",
		run: "interrupted",
	},
} as const satisfies Record<
	CutShort["kind"],
	{
		session: Pick<
			EnginePayloads["SessionEnded"],
			"outcome" | "error" | "errorKind"
		>;
		step: CutShortOutcome;
		run: EnginePayloads["RunEnded"]["status"];
	}
>;

/**
 * Pure: the events that end the run's open work, in the order they are
 * appended. Sessions, then steps from the inside out, then the run. The
 * step error and the run reason follow the cut:
 *
 * - `stopped`: no error, no reason.
 * - `overdue`: the overdue step gets its timer's error; the steps around it
 *   and the run fail with the reason a failed step gives (`route`). A step
 *   with no activity for its idle limit also lands a `stalled` warning.
 * - `interrupted`: every step gets "Night Shift stopped while this ran.";
 *   the run gets `cut.reason`.
 *
 * `flows` gives each step its node (null: no step has one). A step of a
 * kind an old log has and the engine no longer knows keeps its outputs.
 */
export function closingEvents(
	runState: RunState,
	cut: CutShort,
	flows: RunFlows | null,
): ClosingEvent[] {
	const open = openWork(runState, cut.kind);
	const rule = CUTS[cut.kind];
	const reason =
		cut.kind === "overdue"
			? `Node "${cut.nodeId}" failed: ${cut.error}`
			: cut.kind === "interrupted"
				? cut.reason
				: null;
	const stepError = (step: DerivedStep): string | null => {
		if (cut.kind === "overdue") {
			return step.id === cut.stepId ? cut.error : reason;
		}
		return cut.kind === "interrupted" ? rule.session.error : null;
	};
	const closing: ClosingEvent[] = open.sessions.map((session) => ({
		type: "SessionEnded",
		stepId: session.stepId,
		sessionId: session.id,
		payload: { ...rule.session, usage: null, costUsd: null, resetAt: null },
	}));
	for (const step of open.steps) {
		// The kind says what a cut-short step ends with; the node is the
		// logged kind's, or missing when the snapshot has no node for it.
		const node = flows
			? nodesOf(flows, withEnclosing(runState, step.id)).get(step.id)
			: undefined;
		closing.push({
			type: "StepEnded",
			stepId: step.id,
			payload: {
				outcome: rule.step,
				outputs: cutShortOutputsOf(step, node, rule.step),
				error: stepError(step),
			},
		});
		// No activity: the stall guard's warning, as the step's timer lands it.
		if (
			cut.kind === "overdue" &&
			cut.reason === "idle" &&
			step.id === cut.stepId
		) {
			closing.push({
				type: "RunWarned",
				stepId: step.id,
				payload: { kind: "stalled", message: cut.error },
			});
		}
	}
	if (open.endsRun) {
		closing.push({
			type: "RunEnded",
			payload: { status: rule.run, reason },
		});
	}
	return closing;
}

export type CloseDeps = {
	db: Database;
	log: RunLog;
	bus: RunBus;
	flowOf(row: RunRow): Flow;
	calledFlowsOf(row: RunRow): Record<string, Flow>;
	/** What the run holds: let go once its end is written. Default: nothing. */
	holds?: RunHolds;
};

/**
 * Ends the run's open work as `cut` says (`closingEvents`), from the run's
 * whole log, and tells the bus: `step-changed` per step, `status-changed`
 * at the end. Appends nothing when nothing is open. A run that ends lets
 * go of what it holds (`deps.holds`). Takes no lock and forgets no timer:
 * both are the caller's.
 */
export async function closeOpenWork(
	deps: CloseDeps,
	runId: string,
	cut: CutShort,
): Promise<void> {
	const runState = await deps.log.state(runId);
	const flows =
		openWork(runState, cut.kind).steps.length > 0
			? await runFlowsOf(deps, runId)
			: null;
	const closing = closingEvents(runState, cut, flows);
	for (const event of closing) {
		await deps.log.append({ ...event, runId });
		if (event.type === "StepEnded") {
			deps.bus.publish(runId, { kind: "step-changed", stepId: event.stepId });
		}
		if (event.type === "RunEnded" && deps.holds) {
			await letGo(deps.holds, runId, event.payload.status);
		}
	}
	if (closing.length > 0) deps.bus.publish(runId, { kind: "status-changed" });
}

/**
 * The run's flows, from its row; null when the row is missing or its
 * snapshot cannot be read. The work still ends: startup recovery must not
 * stop at one broken run.
 */
async function runFlowsOf(
	deps: CloseDeps,
	runId: string,
): Promise<RunFlows | null> {
	try {
		const row = await getRunRow(deps.db, runId);
		return { flow: deps.flowOf(row), called: deps.calledFlowsOf(row) };
	} catch (error) {
		console.warn(
			`[engine] the flow of run ${runId} cannot be read: its open steps end without their nodes`,
			error,
		);
		return null;
	}
}

/**
 * The outputs a cut-short step ends with (`NodeKind.cutShortOutputs`). A
 * step of a kind that no longer exists (a log from before the kinds of
 * today, such as a `gate` step) keeps its outputs, as a plain kind does.
 */
function cutShortOutputsOf(
	step: DerivedStep,
	node: FlowNode | undefined,
	outcome: CutShortOutcome,
): StepOutputs {
	const kind: NodeKind | undefined = NODE_KINDS[step.nodeType] as
		| NodeKind
		| undefined;
	return (kind ?? PLAIN_KIND).cutShortOutputs(step, node, outcome);
}

/**
 * The node of each step in a chain of calling steps (inside out, as
 * `withEnclosing` gives it): the outermost is in the run's flow, each inner
 * one in the flow its caller's Call node names. Stops at a node the
 * snapshot does not have.
 */
function nodesOf(
	flows: RunFlows,
	chain: readonly DerivedStep[],
): Map<string, FlowNode> {
	const nodes = new Map<string, FlowNode>();
	let current: Flow | undefined = flows.flow;
	for (const step of [...chain].reverse()) {
		const node: FlowNode | undefined = current?.nodes.find(
			(n) => n.id === step.nodeId,
		);
		if (!node) break;
		nodes.set(step.id, node);
		current = node.type === "call" ? flows.called[node.flow] : undefined;
	}
	return nodes;
}
