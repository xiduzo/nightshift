import type { RunState } from "../../log";
import type { ResumeValue } from "../state";
import { type Interrupt, resumeEach, type ThreadSnapshot } from "./thread";
import type { Intent } from "./turn";

/**
 * Where an answer to a Gate goes, from the log and the thread (`planAnswer`,
 * pure). The answer side of `planWake`: the runner's answer Turn reads the
 * facts, asks the plan, and does what it says.
 */

/** An answer to a Gate whose answer the thread had, and went on with. */
export const CONTINUED = "This Gate has its answer. The run continues with it.";
/** An answer to a Gate that the walk left behind. */
export const GATE_GONE = "This Gate does not wait anymore.";

/** What an answer does to a run (`planAnswer`). */
export type AnswerPlan =
	/** The answer is refused with `words`: nothing moves. */
	| { kind: "refuse"; words: string }
	/**
	 * The thread took this Gate's answer already, and the daemon died before
	 * its super-step ended: the drive continues, and the Gate goes on with
	 * its first answer.
	 */
	| { kind: "drive-on" }
	/**
	 * The thread does not hold this Gate's interrupt (the daemon died before
	 * it was saved): the drive continues to it first, then the plan is asked
	 * again with `afterPreDrive`.
	 */
	| { kind: "pre-drive" }
	/** The thread resumes with `value`, by interrupt id (`each`) when it holds more than one Gate. */
	| {
			kind: "resume";
			value: ResumeValue;
			each?: Record<string, ResumeValue>;
	  };

/** An answer from a person or a deadline. */
export type GateAnswer = Omit<Extract<Intent, { kind: "answer" }>, "kind">;

/**
 * Pure: where `answer` goes. `snapshot` is the thread's latest checkpoint,
 * `run` the log, both read after the drive before (`afterPreDrive`).
 *
 * - A task of the thread took this Gate's answer already: the daemon died
 *   before its super-step ended. The drive goes on, and holds what waits
 *   beside it (`driveGraph`), so the Gate goes on with its first answer.
 * - The thread sits elsewhere, or a task has no interrupt: the drive goes
 *   on to this Gate first.
 * - After that drive, a thread that went on past the Gate is refused: with
 *   the answer it had (`CONTINUED`), or without one (`GATE_GONE`).
 * - Else the thread resumes with the answer. While another Gate is open in
 *   the log, it goes by the id of this Gate's interrupt: an answer without
 *   an id goes to the first interrupt that asks. Each other interrupt gets
 *   a hold (`resumeEach`): it keeps waiting, and the answered branch goes
 *   on at once.
 */
export function planAnswer(
	snapshot: Pick<ThreadSnapshot, "state" | "answered">,
	run: RunState,
	answer: GateAnswer,
	options: { afterPreDrive: true },
): Exclude<AnswerPlan, { kind: "drive-on" | "pre-drive" }>;
export function planAnswer(
	snapshot: Pick<ThreadSnapshot, "state" | "answered">,
	run: RunState,
	answer: GateAnswer,
	options: { afterPreDrive: false },
): AnswerPlan;
export function planAnswer(
	snapshot: Pick<ThreadSnapshot, "state" | "answered">,
	run: RunState,
	answer: GateAnswer,
	{ afterPreDrive }: { afterPreDrive: boolean },
): AnswerPlan {
	const { stepId } = answer;
	const isThis = ({ value }: Interrupt) =>
		value.kind === "gate" && value.stepId === stepId;
	const at = snapshot.state;
	if (afterPreDrive) {
		if (at.kind !== "interrupted" || !at.interrupts.some(isThis)) {
			const step = run.steps.get(stepId);
			const answered = (step?.gateWaits.at(-1)?.answeredBy ?? null) !== null;
			return { kind: "refuse", words: answered ? CONTINUED : GATE_GONE };
		}
	} else {
		if (snapshot.answered.some(isThis)) return { kind: "drive-on" };
		if (
			(at.kind === "interrupted" && !at.interrupts.some(isThis)) ||
			at.kind === "pending"
		) {
			return { kind: "pre-drive" };
		}
	}
	const { choice, note, byDeadline, data, via } = answer;
	const value: ResumeValue = {
		kind: "gate",
		choice,
		note,
		...(byDeadline ? { byDeadline } : {}),
		...(data !== undefined ? { data } : {}),
		...(via ? { via } : {}),
	};
	const mine = at.kind === "interrupted" ? at.interrupts.find(isThis) : null;
	const each =
		resumeEach(at, (parked) =>
			parked.kind === "gate" && parked.stepId === stepId ? value : null,
		) ?? (mine && run.gates.length > 1 ? { [mine.id]: value } : null);
	return { kind: "resume", value, ...(each ? { each } : {}) };
}
