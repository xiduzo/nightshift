import { type DerivedStep, type RunState, scopeKey } from "../log";
import { deriveSteps } from "./run-views";

/** Why a branch's step was aborted: another branch reached a `first` Join. */
export const OUTRUN_ERROR = "Another branch reached the Join first.";

/**
 * What a warning (`answer-dropped`) says first when an answer that waited
 * for the drive (`AnswerQueued`) did not reach its Gate. Why comes after.
 */
export const ANSWER_DROPPED = "Your answer did not reach the Gate.";

/**
 * The Agent step whose harness session gets the prompt of a resume, from the
 * log of a run that ended. Null: no session waits. The resume itself
 * (`planReentry`) and the run page ask this one rule, so the person reads
 * which session gets what they type. Parallel branches can wait with a
 * session each, and one prompt goes to one of them: the one whose step
 * started last. Of those that failed on their own outcome, only the one that
 * the run's end names counts (`parkedOn`).
 */
export function waitingSession(run: RunState): DerivedStep | null {
	if (!run.end) return null;
	const steps = deriveSteps(run);
	if (run.end.status === "finished") {
		// A resume opens the last step again, not an element that ended.
		const last = steps.at(-1);
		return last && isAgent(run, last) && !inEndedItem(run, last) ? last : null;
	}
	const rerun = run.resumes.findLast((e) => e.payload.action === "rerun");
	const latest = new Map<string, string>();
	for (const step of steps) latest.set(placeOf(step), step.id);
	/** The step is the last of its node, in the walk that goes on. */
	const current = (step: DerivedStep) =>
		latest.get(placeOf(step)) === step.id &&
		step.openedSeq > (rerun?.seq ?? -1) &&
		!movedOn(run, step);
	const inside = (step: DerivedStep): boolean => {
		const { scope } = step;
		if (!scope) return true;
		const caller = run.steps.get(scope.parentStepId);
		return (
			caller !== undefined &&
			current(caller) &&
			isCutShort(caller) &&
			inside(caller)
		);
	};
	return (
		steps.findLast(
			(step) =>
				isAgent(run, step) &&
				current(step) &&
				(isCutShort(step) || parkedOn(run, step)) &&
				inside(step) &&
				!inEndedItem(run, step),
		) ?? null
	);
}

/**
 * The wait that a wake ends (`planWake`). Parallel branches may sleep at
 * once: a signal ends the wait for that signal, a timer or a person the one
 * that wakes first.
 */
export function wakesNext(
	run: RunState,
	signal?: string,
): RunState["waits"][number] | null {
	const forSignal =
		signal !== undefined
			? run.waits.find((wait) => wait.payload.signal === signal)
			: undefined;
	if (forSignal) return forSignal;
	const at = (wait: RunState["waits"][number]) =>
		wait.payload.until ?? Number.POSITIVE_INFINITY;
	return [...run.waits].sort((a, b) => at(a) - at(b))[0] ?? null;
}

/**
 * Whether a session takes the prompt of a resume: that of the step a wake
 * continues, else the one that waits.
 */
export function takesPrompt(run: RunState): boolean {
	if (run.status !== "sleeping") return waitingSession(run) !== null;
	const stepId = wakesNext(run)?.stepId;
	const step = stepId ? run.steps.get(stepId) : undefined;
	return step !== undefined && isAgent(run, step);
}

const placeOf = (step: DerivedStep) =>
	`${scopeKey(step.scope)}\n${step.nodeId}`;

/**
 * An Agent's step with a session to continue: its own, or the one it went on
 * from when its own got no name. That one counts when the checkpoint kept it:
 * the step failed, or it slept.
 */
function isAgent(run: RunState, step: DerivedStep): boolean {
	return (
		step.nodeType === "agent" &&
		step.sessions.some(
			(s) =>
				s.harnessSessionId !== null ||
				(s.resumeSessionId !== null &&
					(parkedOn(run, step) || step.sleeps.length > 0)),
		)
	);
}

/** The step is inside an element of a Call with `each`, and that element ended. */
function inEndedItem(run: RunState, step: DerivedStep): boolean {
	const { scope } = step;
	const caller = scope && run.steps.get(scope.parentStepId);
	if (!scope || !caller) return false;
	const item = caller.items.findLast((i) => i.facts.id === scope.itemId);
	return item?.open === false || inEndedItem(run, caller);
}

/** The walk took an edge from the step's node after the step ended. */
function movedOn(run: RunState, step: DerivedStep): boolean {
	const taken = run.edges.get(scopeKey(step.scope))?.taken ?? [];
	return taken.some(
		(e) => e.payload.from === step.nodeId && e.seq > step.openedSeq,
	);
}

/** Open, or ended by a stop, an error or a daemon death. Not a branch that another one outran. */
function isCutShort(step: DerivedStep): boolean {
	if (step.error === OUTRUN_ERROR) return false;
	return (
		step.outcome === null ||
		step.outcome === "stopped" ||
		step.outcome === "error" ||
		step.outcome === "interrupted"
	);
}

/**
 * The run failed on the step's own end, which no edge leaves: that end of
 * the run names the node (`RunEnded.node`). An end logged before the node
 * was stored names none.
 */
function parkedOn(run: RunState, step: DerivedStep): boolean {
	const end = step.openings.at(-1)?.end;
	return run.ends.some(
		(e) => end != null && e.seq > end.seq && e.payload.node === step.nodeId,
	);
}
