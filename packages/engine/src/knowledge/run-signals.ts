import type { Flow, FlowNodeType } from "@nightshift/flows";

/**
 * Whether a run that ended is worth a look back (ADR 37), and why. Pure:
 * the run as the read model gives it, and the run of the same flow before
 * it. A run without a signal costs nothing: no evidence, no model.
 *
 * The signals, strongest last:
 *
 * - `fixed`: a step failed, and a later try of the same node in the run
 *   did not. What fixed it is the lesson.
 * - `fixed-since`: the run before failed at a node, and this run passed it.
 * - `same-failure`: this run failed at the node the run before failed at:
 *   a flaky test, a service that is down.
 * - `asked`: a step needed a person. An agent ended on `needs-input`, or a
 *   person answered for an agent, or a person answered after the tries
 *   before ran out.
 * - `gate-reason`: a person answered a Gate and wrote why.
 *
 * A test run (ADR 27) has none: it keeps nothing that lasts.
 *
 * The types here are what the look back reads of a run: the run's detail
 * of the read model fits them. The knowledge does not import the read
 * model, which reads the knowledge.
 */

/** One step of a run, as the look back reads it. */
export type LearningStep = {
	id: string;
	nodeId: string;
	nodeType: FlowNodeType;
	visit: number;
	startedAt: number;
	endedAt: number | null;
	/** Null while the step runs. */
	outcome: string | null;
	outputs: Record<string, unknown>;
	error: string | null;
	/** Set when the step ran inside a called flow. */
	scope: { parentStepId: string; itemId: string | null } | null;
	/** A Gate or an Ask: what it asked. */
	gate: { question: string } | null;
};

/** One time a person stepped in on a run. */
export type LearningStepIn = {
	reason: string;
	at: number;
	planned?: boolean;
	nodeId?: string;
};

/** A run, as the look back reads it. */
export type LearningRun = {
	id: string;
	flowName: string | null;
	status: string;
	/** Why the run failed, or which label ended it. */
	reason: string | null;
	/** The copy of the flow the run started from. */
	flow: Flow;
	/** The flows it can call, by name. */
	calledFlows: Record<string, Flow>;
	/** In the order they started. */
	steps: readonly LearningStep[];
	/** Each time a person stepped in, oldest first. */
	neededYou?: readonly LearningStepIn[];
	/** A test run: it keeps nothing that lasts. */
	test?: unknown;
};

/** Why a run is worth a look back. Step ids are of `run`, `previous…` of the run before. */
export type LearningSignal =
	| {
			kind: "fixed";
			nodeId: string;
			failedStepId: string;
			fixedStepId: string;
	  }
	| {
			kind: "fixed-since";
			nodeId: string;
			previousRunId: string;
			previousStepId: string;
			fixedStepId: string;
	  }
	| {
			kind: "same-failure";
			nodeId: string;
			stepId: string;
			previousRunId: string;
			previousStepId: string;
	  }
	| { kind: "asked"; nodeId: string; stepId: string }
	| {
			kind: "gate-reason";
			nodeId: string;
			stepId: string;
			choice: string;
			note: string;
	  };

/** Outcomes of a try that did not hold. */
const FAILED = new Set(["fail", "error"]);

/** Outcomes that say nothing about the work: a person or the computer stopped it. */
const CUT_SHORT = new Set(["stopped", "interrupted"]);

/** Whether a step failed: it ended `fail` or `error`. */
export function failedStep(step: LearningStep): boolean {
	return step.outcome !== null && FAILED.has(step.outcome);
}

/** Whether a step did its work: it ended, and not as failed, stopped or needing input. */
function heldStep(step: LearningStep): boolean {
	return (
		step.outcome !== null &&
		!FAILED.has(step.outcome) &&
		!CUT_SHORT.has(step.outcome) &&
		step.outcome !== "needs-input" &&
		step.error === null
	);
}

/**
 * Which flow a step's node is in: the run's own when the step is at the
 * top level, else the first called flow that has the node. Two tries of
 * one node are one key.
 */
function nodeKey(run: LearningRun, step: LearningStep): string {
	if (step.scope === null) return `/${step.nodeId}`;
	for (const [name, flow] of Object.entries(run.calledFlows)) {
		if (flow.nodes.some((node) => node.id === step.nodeId)) {
			return `${name}/${step.nodeId}`;
		}
	}
	return `?/${step.nodeId}`;
}

/**
 * The step the run failed at: the last failed step that is not a Subflow
 * step whose called flow failed inside it. Null: none failed.
 */
export function failedAt(run: LearningRun): LearningStep | null {
	const failed = run.steps.filter(failedStep);
	const parents = new Set(
		failed.flatMap((step) => (step.scope ? [step.scope.parentStepId] : [])),
	);
	return failed.findLast((step) => !parents.has(step.id)) ?? null;
}

/** What a person wrote when they answered a Gate, trimmed. Empty: nothing. */
function noteOf(step: LearningStep): string {
	const note = step.outputs.note;
	return typeof note === "string" ? note.trim() : "";
}

/**
 * Whether a person (not a deadline) answered the step's Gate or Ask: an
 * answer to its node after the step started, and before the node's next
 * step started. The answer lands a moment after the step's end.
 */
function personAnswered(run: LearningRun, step: LearningStep) {
	const next = run.steps.find(
		(other) => other.nodeId === step.nodeId && other.startedAt > step.startedAt,
	);
	const until = next?.startedAt ?? Number.POSITIVE_INFINITY;
	return (run.neededYou ?? []).find(
		(act) =>
			(act.reason === "gate" || act.reason === "ask") &&
			act.nodeId === step.nodeId &&
			act.at >= step.startedAt &&
			act.at < until,
	);
}

/**
 * Why `run` is worth a look back, in the order of its steps. Empty: it is
 * not, and nothing more is read. `previous`: the run of the same flow that
 * ended before it, or null.
 */
export function learningSignals(
	run: LearningRun,
	previous: LearningRun | null,
): LearningSignal[] {
	if (run.test !== undefined) return [];
	const signals: LearningSignal[] = [];
	/** The first failed try of each node that no later try has fixed yet. */
	const open = new Map<string, LearningStep>();
	for (const step of run.steps) {
		const key = nodeKey(run, step);
		if (failedStep(step)) {
			if (!open.has(key)) open.set(key, step);
		} else if (heldStep(step) && open.has(key)) {
			const failed = open.get(key) as LearningStep;
			open.delete(key);
			signals.push({
				kind: "fixed",
				nodeId: step.nodeId,
				failedStepId: failed.id,
				fixedStepId: step.id,
			});
		}
		if (step.outcome === "needs-input") {
			signals.push({ kind: "asked", nodeId: step.nodeId, stepId: step.id });
			continue;
		}
		const answered = step.gate ? personAnswered(run, step) : undefined;
		if (!answered) continue;
		const note = noteOf(step);
		if (step.nodeType === "decision" && note !== "" && step.outcome) {
			signals.push({
				kind: "gate-reason",
				nodeId: step.nodeId,
				stepId: step.id,
				choice: step.outcome,
				note,
			});
		} else if (step.nodeType === "agent" || answered.planned === false) {
			signals.push({ kind: "asked", nodeId: step.nodeId, stepId: step.id });
		}
	}
	const before =
		previous && previous.test === undefined ? failedAt(previous) : null;
	if (previous && before) {
		const key = nodeKey(previous, before);
		const now = failedAt(run);
		if (now && nodeKey(run, now) === key) {
			signals.push({
				kind: "same-failure",
				nodeId: now.nodeId,
				stepId: now.id,
				previousRunId: previous.id,
				previousStepId: before.id,
			});
		} else {
			const fixed = run.steps.find(
				(step) => heldStep(step) && nodeKey(run, step) === key,
			);
			const fixedHere = signals.some(
				(signal) => signal.kind === "fixed" && signal.nodeId === before.nodeId,
			);
			if (fixed && !fixedHere) {
				signals.push({
					kind: "fixed-since",
					nodeId: fixed.nodeId,
					previousRunId: previous.id,
					previousStepId: before.id,
					fixedStepId: fixed.id,
				});
			}
		}
	}
	return signals;
}
