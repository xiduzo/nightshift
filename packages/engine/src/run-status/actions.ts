import { Refusal, type RefusalKind } from "@nightshift/refusal";

import type { RunResult, RunStatus } from "./status";

/**
 * Which actions a run allows now, and why not: one rule. The engine
 * refuses by it (`run/actions.ts`, the walk's own guards), and the screens
 * offer only what it allows (`@nightshift/client` passes it on). It needs
 * only the run's status and whether the computer that takes the action
 * walks the run.
 */

/** What a person does to a run. */
export type RunAction =
	/** Stop it now, or after its running step. */
	| "stop"
	/** Answer its open Gate. */
	| "answer"
	/** Send the Signal its Wait node waits for. */
	| "signal"
	/** Give it another Walker ("Move to…"). */
	| "move"
	/** Continue it at its last step, or wake it early. */
	| "resume"
	/** Stop its running step and start it again at once. */
	| "restart"
	/** Run it again from a node of its own flow. */
	| "rerun";

/** Whether the run allows each action now. */
export type RunActions = Readonly<Record<RunAction, boolean>>;

const ACTIONS: readonly RunAction[] = [
	"stop",
	"answer",
	"signal",
	"move",
	"resume",
	"restart",
	"rerun",
];

/**
 * The actions that travel to the Walker of a run another Device walks, as
 * a Command. Only the Walker takes the others.
 */
const RELAYED: ReadonlySet<RunAction> = new Set([
	"stop",
	"answer",
	"signal",
	"move",
]);

/**
 * Why a run another Device walks refuses an action only its Walker takes,
 * and any Turn of a run that moved to another Device meanwhile.
 */
export const WALKED_ELSEWHERE =
	"Another device runs this run. Try again on that device.";

/**
 * Why a run that moved to this computer refuses every action until it
 * arrived: its new Walker has no Checkpoint of it yet.
 */
export const ARRIVING =
	"This run is still on its way to this computer. Try again in a moment.";

const ENDED_NOTHING_TO_STOP = "This run has ended. There is nothing to stop.";
const NO_GATE = "This run does not wait at a Gate.";
const NO_SIGNAL = "This run does not wait for that signal.";
/** Why a run that a drive holds refuses a Turn that needs it to stand still. */
export const STILL_RUNNING =
	"This run is still running. Stop it or wait for it to end.";
const AT_GATE =
	"This run waits at a Gate. Answer the Gate, or stop the run first.";
const ENDED_RESUME_OR_RERUN =
	"This run has ended. Resume it, or run it again from a step.";
/** Why a run an End node ended does not continue: its flow chose to end it there. */
const CHOSEN_END =
	"This run ended where its flow ends it. Run it again from a step instead.";

/**
 * The actions a run an End node ended does not allow, whatever its status:
 * nothing is left to continue, here or on another Device.
 */
const NOT_AFTER_END: ReadonlySet<RunAction> = new Set([
	"resume",
	"restart",
	"move",
]);

/**
 * For each action, the statuses that do not allow it, with why and what
 * to do instead. A status that is not listed allows the action.
 */
const NOT_NOW: Record<RunAction, Partial<Record<RunStatus, string>>> = {
	stop: {
		finished: ENDED_NOTHING_TO_STOP,
		stopped: ENDED_NOTHING_TO_STOP,
		failed: ENDED_NOTHING_TO_STOP,
		interrupted: ENDED_NOTHING_TO_STOP,
	},
	answer: {
		running: NO_GATE,
		sleeping: NO_GATE,
		finished: NO_GATE,
		stopped: NO_GATE,
		failed: NO_GATE,
		interrupted: NO_GATE,
	},
	signal: {
		running: NO_SIGNAL,
		waiting: NO_SIGNAL,
		finished: NO_SIGNAL,
		stopped: NO_SIGNAL,
		failed: NO_SIGNAL,
		interrupted: NO_SIGNAL,
	},
	move: {
		running:
			"The run is in the middle of a step. Move it when it waits, sleeps or has stopped.",
		finished: "The run has ended. There is nothing to move.",
	},
	resume: {
		running: STILL_RUNNING,
		waiting: AT_GATE,
	},
	restart: {
		waiting:
			"This run waits at a Gate. Answer the Gate, or stop the run and resume it.",
		sleeping: "This run sleeps. Wake it to continue now.",
		finished: "This run has ended. Run it again from a step instead.",
		stopped: ENDED_RESUME_OR_RERUN,
		failed: ENDED_RESUME_OR_RERUN,
		interrupted: ENDED_RESUME_OR_RERUN,
	},
	rerun: {
		running: STILL_RUNNING,
		waiting: AT_GATE,
		sleeping: "This run sleeps. Stop it to run it again from a step.",
	},
};

/**
 * Why the run does not allow `action` now, in words for people, or null
 * when it does. `walkedHere`: the computer that takes the action walks the
 * run (a run's `walker.thisDevice`). `result`: the run's result when an
 * End node ended it (a run's `result`): such a run is only run again. It
 * counts only while the status says the run ended.
 */
export function whyNot(
	action: RunAction,
	status: RunStatus,
	walkedHere: boolean,
	result: RunResult | null = null,
): string | null {
	if (!walkedHere && !RELAYED.has(action)) return WALKED_ELSEWHERE;
	// A result holds while the run stays ended; a live status that moved on wins.
	const ended = status === "finished" || status === "failed";
	if (result !== null && ended && NOT_AFTER_END.has(action)) return CHOSEN_END;
	return NOT_NOW[action][status] ?? null;
}

/** Every action, and whether the run allows it now (`whyNot` says why not). */
export function runActions(
	status: RunStatus,
	walkedHere: boolean,
	result: RunResult | null = null,
): RunActions {
	return Object.fromEntries(
		ACTIONS.map((action) => [
			action,
			whyNot(action, status, walkedHere, result) === null,
		]),
	) as Record<RunAction, boolean>;
}

/**
 * The rules a person's action on a run can break. Each refusal names one,
 * and each has one message.
 */
export type RefusalRule =
	/** Only the Walker takes the action, and another Device walks the run. */
	| "walked-elsewhere"
	/** The run moved to this computer and has not arrived yet (`ARRIVING`). */
	| "arriving"
	/** The run's status does not allow the action (`whyNot`). */
	| "not-now"
	/** The answer is not for the open Gate, or an answer is on its way already. */
	| "gate-closed"
	/** The choice is not one of the Gate's options. */
	| "invalid-answer"
	/** The run waits for no Signal of that name. */
	| "wrong-signal"
	/** A run again from a node its own flow does not have. */
	| "unknown-node"
	/** A run again from a step that is not a step of that node. */
	| "unknown-step"
	/** A restart while no step runs. */
	| "no-step"
	/** A restart of a step that ended. */
	| "step-ended"
	/** A move to the Device that walks the run. */
	| "walks-here"
	/** A move to a Device that is not one of the Person's. */
	| "not-your-device"
	/** An action that needs a Person, without one. */
	| "signed-out"
	/** This computer cannot reach the Walker of the run. */
	| "walker-unreachable";

/** The kind of refusal each rule is: what the API answers it with. */
const RULE_KINDS: Record<RefusalRule, RefusalKind> = {
	"walked-elsewhere": "conflict",
	arriving: "conflict",
	"not-now": "conflict",
	"gate-closed": "conflict",
	"invalid-answer": "invalid",
	"wrong-signal": "conflict",
	"unknown-node": "invalid",
	"unknown-step": "invalid",
	"no-step": "conflict",
	"step-ended": "conflict",
	"walks-here": "invalid",
	"not-your-device": "forbidden",
	"signed-out": "signed-out",
	"walker-unreachable": "unavailable",
};

/**
 * A person asked a run for what it does not allow: the message says why,
 * and what to do. It is a `Refusal` of the kind its rule is.
 */
export class RunRefusal extends Refusal {
	constructor(
		readonly rule: RefusalRule,
		message: string,
	) {
		super(RULE_KINDS[rule], message);
		this.name = "RunRefusal";
	}
}

/** Throws the refusal when the run does not allow `action` now (`whyNot`). */
export function refuseUnless(
	action: RunAction,
	status: RunStatus,
	walkedHere: boolean,
	result: RunResult | null = null,
): void {
	const why = whyNot(action, status, walkedHere, result);
	if (why === null) return;
	throw new RunRefusal(
		walkedHere || RELAYED.has(action) ? "not-now" : "walked-elsewhere",
		why,
	);
}
