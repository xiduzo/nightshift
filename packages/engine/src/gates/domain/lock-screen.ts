import { Refusal } from "@nightshift/refusal";

/**
 * The lock-screen rule: which answers a Gate takes from a button on a
 * notification, without an unlock.
 */

/** The words of an answer from the lock screen that needs the app. */
export const NEEDS_APP = "Open this Gate in Night Shift to answer it.";

/**
 * An answer from the lock screen to a Gate that its author did not mark
 * for the lock screen, or with a choice the Gate does not have.
 */
export class NeedsApp extends Refusal {
	constructor() {
		super("forbidden", NEEDS_APP);
		this.name = "NeedsApp";
	}
}

/** An open Gate as the rule reads it. `OpenGate` of the views fits. */
export type LockScreenGate = {
	runId: string;
	stepId: string;
	choices: readonly { name: string }[];
	/** Its author marked it for the lock screen. */
	lockScreen: boolean;
	/** An answer to it is on its way to the run's Walker. */
	answerPending: boolean;
};

/**
 * Why an answer from the lock screen does not go to a Gate, or null when
 * it does. A Gate takes it only when its author marked it for the lock
 * screen and the choice is one of its own: the push that shows the
 * buttons is not proof of that. `gate-closed`: the Gate is not open, or an
 * answer is on its way. `needs-app`: the answer needs the app. `open` is
 * the Space's open Gates.
 */
export function lockScreenRefusal(
	open: readonly LockScreenGate[],
	answer: { runId: string; stepId: string; choice: string },
): "gate-closed" | "needs-app" | null {
	const gate = open.find(
		(one) => one.runId === answer.runId && one.stepId === answer.stepId,
	);
	if (!gate || gate.answerPending) return "gate-closed";
	const known = gate.choices.some((choice) => choice.name === answer.choice);
	return gate.lockScreen && known ? null : "needs-app";
}
