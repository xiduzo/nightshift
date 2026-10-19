import type { Flow, FlowNode } from "@nightshift/flows";

import {
	countVisits,
	type DerivedStep,
	deriveInputs,
	deriveNodeOutputs,
	deriveSteps,
	deriveStopAt,
	deriveTraversals,
	type LoggedEvent,
	type Scope,
	scopeKey,
} from "../events";
import { DEFAULT_RESUME_PROMPT } from "./context";
import type { Pending, RunStateUpdate, RunStateValues } from "./state";
import type { StepStart } from "./step-runner";

/**
 * The one resume point: how a node re-enters after a park, a wake, a resume
 * or a daemon death. It answers one question for every node kind, from the
 * checkpoint (`state.pending`, `state.loops`, `state.visits`) and the log:
 * does the node start a new visit, continue a step the log still has open,
 * or reopen a step that ended (`StepReopened`)?
 *
 * This is a deep module behind a small interface: `resumePoint()` returns
 * `{ kind: "new" }`, `{ kind: "continue", step }` or `{ kind: "reopen",
 * step, prompt }`, and `entryOf()` turns that into the `StepStart`
 * `beginStep` takes. The five node kinds that used to answer the question
 * each in their own way differ only in *which* existing step they take up
 * again, so that is all `ResumeRules` lets them say. The order of the
 * sources, the open-or-ended rule, the harness session and the resume prompt
 * are decided once here. Keeping the rule in one place gives locality (a
 * change to recovery lands in one file) and leverage (one table test covers
 * every kind).
 *
 * The daemon side of the same question lives here too: `resumeTarget` (what
 * `RunResumed` records), `reenteredNode` and `reentryUpdate` (how a thread
 * with no checkpoint at an interrupt is re-entered). They share `sessionOf`
 * and the walk-front derivation with the node side, so what the engine
 * promises in `RunResumed` is what the node finds when it re-enters.
 *
 * The log is written exactly as before (design rule 3): this module appends
 * nothing; it only decides.
 *
 * The rule, in order. For a node `n` in scope `s`:
 *
 * 1. `pending` is this node's wait that ended (the runner appended
 *    `WaitEnded`): the step it names continues when it is still open, and
 *    is reopened when recovery ended it meanwhile (the daemon died after the
 *    wake). The prompt is the latest `RunResumed` for the step, else the
 *    wait's own follow-up.
 * 2. `pending` is this node's parked step and a person resumed: the step is
 *    taken up (reopened) when the rules say so (`parked`), else a new visit.
 *    The prompt is the resume's, else "Continue where you left off.".
 * 3. The node loops over elements (`loops`, Call with `each`): the latest
 *    step of the node in this scope continues (open) or is reopened (ended).
 * 4. The log has a step of this node in this scope that the checkpoint
 *    never saw (`uncommittedStep`, design rule 5: the daemon died while it
 *    ran): taken up when the rules say so (`crashed`), else a new visit.
 * 5. Else a new visit.
 *
 * A step is "open" while `endedAt` is null. The prompt and the harness
 * session are set only for a step that has a harness session to continue:
 * a Call or a Decision step has none, so its `StepReopened` carries
 * `prompt: null`, as before.
 */

/** What a node does with its step when it re-enters. */
export type ResumePoint =
	| { kind: "new" }
	| {
			kind: "continue";
			step: DerivedStep;
			/** The harness session the step continues, when it has one. */
			harnessSessionId: string | null;
			/** The follow-up for that session; null without one. */
			prompt: string | null;
	  }
	| {
			kind: "reopen";
			step: DerivedStep;
			harnessSessionId: string | null;
			prompt: string | null;
	  };

/**
 * The per-kind flags: which existing step a node kind takes up again. These
 * are the only genuine differences between the node kinds.
 */
export type ResumeRules = {
	/**
	 * A step a person resumed after it parked the run (`pending.kind ===
	 * "parked"`). `new`: the node has nothing to continue (a Call once, a
	 * Decision, a Wait). `with-session`: only a step with a harness session,
	 * which the session continues with the resume prompt (an Agent).
	 * `cut-short`: only a step that ended `stopped`, `error` or
	 * `interrupted`, so the work goes on where it stopped; an exhausted loop
	 * (`done`, `halted` with no edge) starts over (a Call with `each`).
	 */
	parked: "new" | "with-session" | "cut-short";
	/**
	 * The step the log has that the checkpoint never saw (the daemon died
	 * while it ran). `new`: a new visit, the recovered step stays ended
	 * (a Decision by a model, a Wait). `take-up`: continue it open, reopen it
	 * ended (a Call: its body resumes under the same namespace).
	 * `with-session`: reopened when it has a harness session, open or ended
	 * (an Agent: the harness process is gone, so the session is invoked
	 * again with a prompt). `asked-gate`: continued only while it is open
	 * with its Gate asked (`GateOpened` after its latest opening): the crash
	 * window between `GateOpened` and the checkpoint commit must not open a
	 * second Gate. A Gate step that ended is not reused.
	 */
	crashed: "new" | "take-up" | "with-session" | "asked-gate";
	/** The node loops over elements: mid-loop its latest step continues. */
	loop?: boolean;
};

/** The rules of each node kind, by name. One table, read by the nodes and the tests. */
export const RESUME_RULES = {
	agent: { parked: "with-session", crashed: "with-session" },
	/** A Decision decided by a model, and a Value made by one. */
	model: { parked: "new", crashed: "new" },
	call: { parked: "new", crashed: "take-up" },
	callEach: { parked: "cut-short", crashed: "take-up", loop: true },
	gate: { parked: "new", crashed: "asked-gate" },
	wait: { parked: "new", crashed: "new" },
	/** A Command, a Tool, a Decision decided by a rule, a Value made by one: every visit is new. */
	fresh: { parked: "new", crashed: "new" },
} as const satisfies Record<string, ResumeRules>;

/** Decides how `node` re-enters. Appends nothing. */
export function resumePoint(
	node: Pick<FlowNode, "id">,
	state: Pick<RunStateValues, "pending" | "loops" | "visits">,
	events: readonly LoggedEvent[],
	scope: Scope | null,
	rules: ResumeRules,
): ResumePoint {
	const steps = deriveSteps(events);
	const pending = ownPending(node, state.pending);

	if (pending?.kind === "wait") {
		const own = steps.find((s) => s.id === pending.stepId);
		if (!own) return { kind: "new" };
		const session = pending.harnessSessionId ?? sessionOf(own);
		return takeUp(own, session, {
			continued: pending.prompt,
			reopened: resumePromptOf(events, own) ?? pending.prompt,
		});
	}

	if (pending?.kind === "parked") {
		const own = pending.stepId
			? steps.find((s) => s.id === pending.stepId)
			: undefined;
		if (!own) return { kind: "new" };
		const session = pending.harnessSessionId ?? sessionOf(own);
		const prompt = pending.prompt ?? DEFAULT_RESUME_PROMPT;
		switch (rules.parked) {
			case "new":
				return { kind: "new" };
			case "with-session":
				return session ? reopen(own, session, prompt) : { kind: "new" };
			case "cut-short":
				return isCutShort(own)
					? takeUp(own, session, { continued: prompt, reopened: prompt })
					: { kind: "new" };
		}
	}

	if (rules.loop && state.loops[node.id]) {
		const latest = latestStepOf(node, events, scope);
		if (latest) return takeUpFromLog(events, latest);
	}

	const crashed = uncommittedStep(node, state, events, scope);
	if (!crashed) return { kind: "new" };
	switch (rules.crashed) {
		case "new":
			return { kind: "new" };
		case "take-up":
			return takeUpFromLog(events, crashed);
		case "with-session": {
			const session = sessionOf(crashed);
			return session
				? reopen(
						crashed,
						session,
						resumePromptOf(events, crashed) ?? DEFAULT_RESUME_PROMPT,
					)
				: { kind: "new" };
		}
		case "asked-gate":
			return gateAsked(crashed)
				? {
						kind: "continue",
						step: crashed,
						harnessSessionId: null,
						prompt: null,
					}
				: { kind: "new" };
	}
}

/** The `StepStart` for `beginStep`: the seam between deciding and appending. */
export function entryOf(point: ResumePoint): StepStart {
	switch (point.kind) {
		case "new":
			return { kind: "new" };
		case "continue":
			return { kind: "continue", stepId: point.step.id };
		case "reopen":
			return { kind: "reopen", stepId: point.step.id, prompt: point.prompt };
	}
}

/** This node's `pending`, or null when the pending step is another node's. */
function ownPending(
	node: Pick<FlowNode, "id">,
	pending: Pending | null,
): Pending | null {
	return pending?.nodeId === node.id ? pending : null;
}

/** An existing step: continued while open, reopened once ended. */
function takeUp(
	step: DerivedStep,
	session: string | null,
	prompts: { continued: string; reopened: string },
): ResumePoint {
	if (step.endedAt !== null) return reopen(step, session, prompts.reopened);
	return {
		kind: "continue",
		step,
		harnessSessionId: session,
		prompt: session ? prompts.continued : null,
	};
}

/** `takeUp` for a step the log alone points at: its prompt is the latest resume's. */
function takeUpFromLog(
	events: readonly LoggedEvent[],
	step: DerivedStep,
): ResumePoint {
	const prompt = resumePromptOf(events, step) ?? DEFAULT_RESUME_PROMPT;
	return takeUp(step, sessionOf(step), { continued: prompt, reopened: prompt });
}

function reopen(
	step: DerivedStep,
	session: string | null,
	prompt: string,
): ResumePoint {
	return {
		kind: "reopen",
		step,
		harnessSessionId: session,
		prompt: session ? prompt : null,
	};
}

/** A step that ended before its work was done: a stop, an error, or a daemon death. */
function isCutShort(step: DerivedStep): boolean {
	return (
		step.outcome === "stopped" ||
		step.outcome === "error" ||
		step.outcome === "interrupted"
	);
}

/** The step's Gate is asked: it is open and `GateOpened` came after its latest opening. */
export function gateAsked(step: DerivedStep): boolean {
	return (
		step.endedAt === null &&
		step.gate !== null &&
		step.gate.openedSeq > step.openedSeq
	);
}

/** The harness session a step has, from the log: the latest session that got one. */
export function sessionOf(step: DerivedStep | undefined): string | null {
	return (
		step?.sessions.findLast((s) => s.harnessSessionId)?.harnessSessionId ?? null
	);
}

/** The prompt the latest `RunResumed` for this step carries, if any. */
export function resumePromptOf(
	events: readonly LoggedEvent[],
	step: DerivedStep,
): string | null {
	const resumed = events.findLast(
		(e) =>
			e.type === "RunResumed" &&
			e.seq > step.startSeq &&
			e.payload.stepId === step.id,
	);
	return resumed?.type === "RunResumed" ? resumed.payload.prompt : null;
}

/**
 * The step of this node the log has but the graph never committed: the
 * daemon died while it ran (design rule 5). The graph's `visits` count the
 * node's committed visits; the log counts one more while a step runs.
 * Recovery ends it `interrupted`; a node that re-runs may take it up.
 */
export function uncommittedStep(
	node: Pick<FlowNode, "id">,
	state: Pick<RunStateValues, "visits">,
	events: readonly LoggedEvent[],
	scope: Scope | null,
): DerivedStep | null {
	const key = scopeKey(scope);
	const logged = countVisits(events, node.id, key);
	if (logged <= (state.visits[node.id] ?? 0)) return null;
	return latestStepOf(node, events, scope);
}

/** The latest step of the node in this scope, as the log has it. */
export function latestStepOf(
	node: Pick<FlowNode, "id">,
	events: readonly LoggedEvent[],
	scope: Scope | null,
): DerivedStep | null {
	const key = scopeKey(scope);
	return (
		deriveSteps(events).findLast(
			(s) => s.nodeId === node.id && scopeKey(s.scope) === key,
		) ?? null
	);
}

// ---------------------------------------------------------------------------
// The daemon side: where the run as a whole continues, from the log.

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
): RunStateUpdate {
	const reentered = reenteredNode(events);
	const visits: Record<string, number> = {};
	for (const node of flow.nodes) {
		const count =
			countVisits(events, node.id, "") - (node.id === reentered ? 1 : 0);
		if (count > 0) visits[node.id] = count;
	}
	return {
		inputs: deriveInputs(events),
		stopAt: deriveStopAt(events),
		visits,
		nodes: deriveNodeOutputs(events, ""),
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
