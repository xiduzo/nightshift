import type { FlowNode } from "@nightshift/flows";
import type { DerivedStep, RunState, Scope } from "../../log";
import { DEFAULT_RESUME_PROMPT, type ResumeRules } from "../context";

import { type DoneStep, isCutShort, positionOf } from "../position";
import type { PositionState } from "../state";
import { resumePrompt } from "./resume-prompt";
import { pendingWaitOf } from "./sleep";
import type { StepStart } from "./step-handle";

/**
 * The one resume point: how a node re-enters after a park, a wake, a resume
 * or a daemon death. It answers one question for every node kind, from the
 * checkpoint (`state.pending`, `state.loops`, `state.visits`) and the log:
 * does the node start a new visit, continue a step the log still has open,
 * or reopen a step that ended (`StepReopened`)?
 *
 * Where the node is comes from the run position (`run-position.ts`): the
 * step the checkpoint holds for it, a loop mid-way, and the step the log
 * has that the checkpoint never committed. This module decides what the
 * node does there.
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
 * The daemon side of the same question is `reentry.ts`: what `RunResumed`
 * records and how the thread moves. It reads `sessionOf` from here, and
 * both read the run position, so what the engine promises in `RunResumed`
 * is what the node finds when it re-enters.
 *
 * The log is written exactly as before (design rule 3): this module appends
 * nothing; it only decides.
 *
 * The rule, in order. For a node `n` in scope `s`:
 *
 * 0. The step the checkpoint holds open or never committed ended on its
 *    own after the last commit (`Position.done`: the daemon died, a stop
 *    came or the engine failed between its end and the commit): the node
 *    goes on from its logged end and runs nothing again (`done`). The same
 *    for every kind.
 * 1. `pending` is this node's wait that ended (the runner appended
 *    `WaitEnded`): the step it names continues when it is still open, and
 *    is reopened when recovery ended it meanwhile (the daemon died after the
 *    wake).
 * 1b. `pending` is this node's Gate that a person answered (an Agent that
 *    asks, `PendingGate.answer`): the step it names is reopened, so the
 *    Gate closes in the log, and its harness session goes on with the
 *    answer. The answer goes once: the reopen that closes the Gate takes it.
 * 2. `pending` is this node's parked step and a person resumed: the step is
 *    taken up (reopened) when the rules say so (`parked`), else a new visit.
 * 3. The node loops over elements (`loops`, Call with `each`): the latest
 *    step of the node in this scope continues (open) or is reopened (ended).
 * 4. The log has a step of this node in this scope that the checkpoint
 *    never saw (`Position.uncommitted`, design rule 5: the daemon died
 *    while it ran): taken up when the rules say so (`crashed`), else a new
 *    visit.
 * 5. Else a new visit.
 *
 * A step is "open" while `endedAt` is null. The prompt of a step that is
 * taken up is what its session was told and did not get yet
 * (`resume-prompt.ts`), whatever the way in. The prompt and the harness
 * session are set only for a step that has a harness session to continue:
 * a Call or a Decision step has none, so its `StepReopened` carries
 * `prompt: null`, as before.
 */

/** What a node does with its step when it re-enters. */
export type ResumePoint =
	| { kind: "new" }
	/** The step is done: the node routes on its logged end (`routeDone`). */
	| ({ kind: "done" } & DoneStep)
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
	state: PositionState,
	runState: RunState,
	scope: Scope | null,
	rules: ResumeRules,
): ResumePoint {
	const at = positionOf(state, runState, scope);
	const done = at.done(node);
	if (done) return { kind: "done", ...done };
	const held = at.held(node);

	const sleeping = pendingWaitOf(held?.pending);
	if (held && sleeping) {
		const own = held.step;
		if (!own) return { kind: "new" };
		const session = sleeping.session?.harnessSessionId ?? sessionOf(own);
		return takeUp(runState, own, session);
	}

	if (held?.pending.kind === "gate" && held.pending.answer !== undefined) {
		const own = held.step;
		if (!own) return { kind: "new" };
		return reopen(
			runState,
			own,
			sessionOf(own),
			own.gate ? held.pending.answer : undefined,
		);
	}

	if (held?.pending.kind === "parked") {
		const { pending, step: own } = held;
		if (!own) return { kind: "new" };
		const session = pending.harnessSessionId ?? sessionOf(own);
		switch (rules.parked) {
			case "new":
				return { kind: "new" };
			case "with-session":
				return session ? reopen(runState, own, session) : { kind: "new" };
			case "cut-short":
				return isCutShort(own)
					? takeUp(runState, own, session)
					: { kind: "new" };
		}
	}

	if (rules.loop && at.looping(node)) {
		const latest = at.latest(node);
		if (latest) return takeUp(runState, latest, sessionOf(latest));
	}

	const crashed = at.uncommitted(node);
	if (!crashed) return { kind: "new" };
	switch (rules.crashed) {
		case "new":
			return { kind: "new" };
		case "take-up":
			return takeUp(runState, crashed, sessionOf(crashed));
		case "with-session": {
			const session = sessionOf(crashed);
			return session ? reopen(runState, crashed, session) : { kind: "new" };
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

/** How a node enters its step: every point but a step that is done, which begins nothing. */
export type StepEntry = Exclude<ResumePoint, { kind: "done" }>;

/**
 * The `StepStart` for `beginStep`: the seam between deciding and appending.
 * A step that is done begins nothing: its node routes on it first.
 */
export function entryOf(point: StepEntry): StepStart {
	switch (point.kind) {
		case "new":
			return { kind: "new" };
		case "continue":
			return { kind: "continue", stepId: point.step.id };
		case "reopen":
			return { kind: "reopen", stepId: point.step.id, prompt: point.prompt };
	}
}

/** An existing step: continued while open, reopened once ended. */
function takeUp(
	runState: RunState,
	step: DerivedStep,
	session: string | null,
): ResumePoint {
	if (step.endedAt !== null) return reopen(runState, step, session);
	return {
		kind: "continue",
		step,
		harnessSessionId: session,
		prompt: session ? resumePrompt(runState, step) : null,
	};
}

function reopen(
	runState: RunState,
	step: DerivedStep,
	session: string | null,
	answer?: string,
): ResumePoint {
	return {
		kind: "reopen",
		step,
		harnessSessionId: session,
		prompt: session ? resumePrompt(runState, step, answer) : null,
	};
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

/**
 * How a new visit of an Agent node runs because a person ran the flow again
 * from it (`RunResumed` with `action: "rerun"`): it continues the harness
 * session of the step `stepId` names with the follow-up `prompt`, or, with
 * `stepId` null, starts a fresh session with the node's own prompt (also on
 * a node with `session: "resume"`). Only for the first step the rerun walk
 * opens, when it is this node's at the top level: later visits run as the
 * node says. `runState` is the run state before the visit's own `StepStarted`.
 * Undefined for any other visit.
 */
export function rerunEntryOf(
	node: Pick<FlowNode, "id">,
	runState: RunState,
	scope: Scope | null,
): { harnessSessionId: string; prompt: string } | null | undefined {
	if (scope) return undefined;
	const resumed = runState.resumes.at(-1);
	if (resumed?.payload.action !== "rerun") return undefined;
	if (resumed.payload.nodeId !== node.id) return undefined;
	const after = resumed.seq;
	// A step the rerun walk opened already: this visit is a later one.
	for (const step of runState.steps.values()) {
		if (step.openings.some((opening) => opening.seq > after)) return undefined;
	}
	const { stepId: from, prompt } = resumed.payload;
	if (from === null) return null;
	const session = sessionOf(runState.steps.get(from));
	return session
		? { harnessSessionId: session, prompt: prompt ?? DEFAULT_RESUME_PROMPT }
		: null;
}
