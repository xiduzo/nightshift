import {
	type AnswerFile,
	answerFilesProblem,
	type JsonValue,
	optionProblem,
} from "@nightshift/flows";
import { RunRefusal, type RunStatus, whyNot } from "../../run-status";

/**
 * The rules of an answer to a Gate: which answer the run's open Gate takes.
 * Each reads the shape of the run it needs: the fold of the run log fits.
 * A rule that reads the log runs inside the run's Turn, so no other Turn
 * comes between the rule and the answer.
 */

/** Why an answer does not go to a run that waits at no Gate. */
export const NO_GATE = "This run does not wait at a Gate.";
/** Why an answer for a step does not go to the Gate another step opened. */
export const NOT_THE_GATE = "That step is not the open Gate of this run.";
/** Why an answer does not travel: one is on its way to the run's Walker already. */
export const ANSWER_ON_ITS_WAY =
	"An answer to this Gate is already on its way to the device that runs it.";
/** Why an answer from the lock screen does not go to a Gate that is not open. */
export const GATE_GONE = "This Gate does not wait anymore.";

/**
 * An answer to a Gate that no longer waits: someone answered it, its run
 * moved on, or an answer is already on its way.
 */
export class GateClosedError extends RunRefusal {
	constructor(message: string) {
		super("gate-closed", message);
		this.name = "GateClosedError";
	}
}

/** One choice of a Gate, as the rules read it. */
export type Choice = { name: string; needsNote?: true };

/** A run as the answer rules read it: its status, and the Gate it waits at. `RunState` fits. */
export type GatedRun<Form> = {
	status: RunStatus;
	gate: {
		stepId: string;
		choices: readonly Choice[];
		/** An Ask's form (ADR 10). Null on every other Gate. */
		form: Form | null;
	} | null;
};

/** An answer to a Gate in the person's words. */
export type GateAnswer = {
	stepId: string;
	choice: string;
	note?: string;
	data?: JsonValue;
	files?: readonly AnswerFile[];
};

/**
 * Why the run's open Gate does not take an answer for `stepId` at all, or
 * null when it does: the run waits at no Gate, or another step's Gate is
 * the open one.
 */
export function closedWhy(
	run: GatedRun<unknown>,
	stepId: string,
): string | null {
	const why = whyNot("answer", run.status, true);
	if (why !== null || !run.gate) return why ?? NO_GATE;
	return run.gate.stepId === stepId ? null : NOT_THE_GATE;
}

/**
 * Throws when `answer` cannot answer the run's open Gate: no Gate is open,
 * another step is (`GateClosedError`), the choice is not one of its
 * options, the choice needs a note and has none (the answer to an Agent),
 * the data does not match the form of an Ask (`askProblem`), or the files
 * are too many or too large (`invalid-answer`).
 */
export function refuseAnswer<Form>(
	run: GatedRun<Form>,
	answer: GateAnswer,
	askProblem: (form: Form, data: unknown) => string | null,
): void {
	const closed = closedWhy(run, answer.stepId);
	if (closed !== null || !run.gate)
		throw new GateClosedError(closed ?? NO_GATE);
	const { choices, form } = run.gate;
	const problem = optionProblem(choices, answer.choice);
	if (problem !== null) throw new RunRefusal("invalid-answer", problem);
	const picked = choices.find((c) => c.name === answer.choice);
	if (picked?.needsNote && (answer.note ?? "").trim() === "") {
		throw new RunRefusal(
			"invalid-answer",
			`Write a note to choose "${answer.choice}". The agent continues with it.`,
		);
	}
	if (form !== null) {
		const wrong = askProblem(form, answer.data);
		if (wrong !== null) throw new RunRefusal("invalid-answer", wrong);
	}
	const tooMany = answerFilesProblem(answer.files ?? []);
	if (tooMany !== null) throw new RunRefusal("invalid-answer", tooMany);
}
