import type { FlowNode } from "@nightshift/flows";
import type { LoggedEvent, Scope } from "../log";
import { type DerivedStep, deriveSteps } from "../read";
import { DEFAULT_RESUME_PROMPT } from "./context";
import { positionOf } from "./run-position";
import { pendingWaitOf } from "./sleep";
import type { RunStateValues } from "./state";
import type { StepStart } from "./step-runner";

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
 *    never saw (`Position.uncommitted`, design rule 5: the daemon died
 *    while it ran): taken up when the rules say so (`crashed`), else a new
 *    visit.
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
	const at = positionOf(state, events, scope);
	const held = at.held(node);

	const sleeping = pendingWaitOf(held?.pending);
	if (held && sleeping) {
		const own = held.step;
		if (!own) return { kind: "new" };
		const session = sleeping.session?.harnessSessionId ?? sessionOf(own);
		const prompt = sleeping.session?.prompt ?? DEFAULT_RESUME_PROMPT;
		return takeUp(own, session, {
			continued: prompt,
			reopened: resumePromptOf(events, own) ?? prompt,
		});
	}

	if (held?.pending.kind === "parked") {
		const { pending, step: own } = held;
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

	if (rules.loop && at.looping(node)) {
		const latest = at.latest(node);
		if (latest) return takeUpFromLog(events, latest);
	}

	const crashed = at.uncommitted(node);
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
 * How a new visit of an Agent node runs because a person ran the flow again
 * from it (`RunResumed` with `action: "rerun"`): it continues the harness
 * session of the step `stepId` names with the follow-up `prompt`, or, with
 * `stepId` null, starts a fresh session with the node's own prompt (also on
 * a node with `session: "resume"`). Only for the first step the rerun walk
 * opens, when it is this node's at the top level: later visits run as the
 * node says. `events` is the log before the visit's own `StepStarted`.
 * Undefined for any other visit.
 */
export function rerunEntryOf(
	node: Pick<FlowNode, "id">,
	events: readonly LoggedEvent[],
	scope: Scope | null,
): { harnessSessionId: string; prompt: string } | null | undefined {
	if (scope) return undefined;
	let resumed: Extract<LoggedEvent, { type: "RunResumed" }> | undefined;
	for (const e of events) {
		if (e.type === "RunResumed" && (!resumed || e.seq > resumed.seq)) {
			resumed = e;
		}
	}
	if (resumed?.payload.action !== "rerun") return undefined;
	if (resumed.payload.nodeId !== node.id) return undefined;
	const after = resumed.seq;
	// A step the rerun walk opened already: this visit is a later one.
	const opened = events.some(
		(e) =>
			e.seq > after && (e.type === "StepStarted" || e.type === "StepReopened"),
	);
	if (opened) return undefined;
	const { stepId: from, prompt } = resumed.payload;
	if (from === null) return null;
	const session = sessionOf(deriveSteps(events).find((s) => s.id === from));
	return session
		? { harnessSessionId: session, prompt: prompt ?? DEFAULT_RESUME_PROMPT }
		: null;
}
