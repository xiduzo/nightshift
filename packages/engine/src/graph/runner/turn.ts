import type { JsonValue } from "@nightshift/flows";
import type {
	GateVia,
	ResumedBy,
	RunRow,
	RunState,
	StoppedBy,
} from "../../log";
import { RunRefusal, type RunStatus } from "../../run-status";
import type { RunHolds } from "./holds";
import type { openThread, ThreadDeps } from "./thread";
import type { Wake } from "./wake";

/**
 * What the runner takes (`RunnerDeps`), what a Turn does to a run
 * (`Intent`) and what it did (`Taken`), with the words the runner says to
 * a Turn it cannot take. `runner.ts` has the runner itself.
 */

/** What the runner takes: what every Thread is opened with, and the runner's own. */
export type RunnerDeps = ThreadDeps & {
	/** Aborting it clears the wake timers, the cap queue and the sweep: the daemon dies. */
	signal?: AbortSignal;
	/** How often the runner looks for steps past their time limits. Default 5 000 ms. */
	overdueSweepMs?: number;
	/** Opens a run's thread. Default `openThread`; a test passes one that fails. */
	openThread?: typeof openThread;
	/** What runs hold for a scope (leases): let go on every end of a run. Default: nothing. */
	holds?: RunHolds;
};

/** What a start's Turn prepares once its slot is held: the run row, its inputs, its stop time and when it was due. */
export type StartPlan = {
	row: RunRow;
	inputs: Record<string, JsonValue>;
	stopAt: number | null;
	/** `{{run.due_at}}` (`runDueAt`). Absent: "". */
	dueAt?: string;
};

/** What a Turn does to a run. */
export type Intent =
	/** Starts a new run. `prepare` runs with the slot held: it writes the row and `RunStarted`. */
	| { kind: "start"; prepare(): Promise<StartPlan> }
	/**
	 * Answers the run's open Gate. The Turn ends once the Gate's step has
	 * ended. The caller checks the answer against the Gate (`check`).
	 */
	| {
			kind: "answer";
			stepId: string;
			choice: string;
			note: string;
			/** Nobody answered: the Gate's deadline chose (`timerTurn`). */
			byDeadline?: true;
			/** The answer to an Ask (ADR 10): the data of its form. */
			data?: JsonValue;
			/** Where the answer came from. Absent: the score stores `_OTHER`. */
			via?: GateVia;
			/** The answer that waited for the drive (`AnswerQueued`): its own Turn now. */
			queued?: true;
	  }
	/** Ends the sleep of a sleeping run (`planWake`): its timer, a person early, or a signal. */
	| ({ kind: "wake" } & Wake)
	/** Continues a run that is not going (`planReentry`), or wakes a sleeping one early with `prompt`. */
	| { kind: "resume"; by: ResumedBy; prompt?: string }
	/** Stops the running step and continues it at once: a stop and a resume in one Turn. */
	| { kind: "restart"; by: ResumedBy; prompt?: string }
	/** Walks a run that is not going again from `nodeId` (`planReentry`). */
	| {
			kind: "rerun";
			by: ResumedBy;
			nodeId: string;
			stepId?: string;
			prompt?: string;
			fresh?: boolean;
	  }
	/** Stops the run now, whatever its drive does: a person, or the daemon (an Offer ended). */
	| { kind: "stop"; by: StoppedBy }
	/** Ends the running step when it ran past its time budget or idle limit by `graceMs`. */
	| { kind: "overdue"; graceMs: number }
	/**
	 * Drops the checkpoint history of a run that ended without a drive here
	 * (startup recovery: the daemon died), as a drive's end drops it.
	 */
	| { kind: "prune" }
	/**
	 * Drives on a run whose drive stopped between two holds for another
	 * Turn (`Walk.yielding`), when that Turn moved nothing: the branches
	 * beside its interrupts go on.
	 */
	| { kind: "go-on" };

/** What a Turn did. */
export type Taken =
	/** A drive holds the run now (start, answer, wake, resume, restart, rerun). */
	| { kind: "driving" }
	/** A stop or an overdue step ended the run's open work. */
	| { kind: "halted" }
	/**
	 * The Turn comes again later: the run cap is full and the caller asked
	 * to queue, or an answer waits for the drive to reach its next hold.
	 */
	| { kind: "queued" }
	/** Nothing to do: the run no longer sleeps, is not going, or its step is within its limits. */
	| { kind: "unchanged" };

export type TakeOptions = {
	/** Default "refuse": a full run cap throws the cap message. "queue": the Turn waits for a free slot. */
	whenFull?: "refuse" | "queue";
	/** What a queued Turn runs when a slot frees. Default: the same `take` again. */
	retry?(): void;
	/** Runs first in the Turn, on the run state: throws to refuse the Turn. */
	check?(runState: RunState): void;
};

/** What `hold` gives its function: the run state, and whether a drive or a Turn holds a slot of it. */
export type Held = {
	row: RunRow;
	runState: RunState;
	active: boolean;
};

/** A restart that came after the drive ended the run itself: there is no step left to restart. */
export class RestartTooLate extends RunRefusal {
	constructor(readonly status: RunStatus) {
		super(
			"step-ended",
			`The step ended before it could restart. The run is ${status} now.`,
		);
		this.name = "RestartTooLate";
	}
}

/** What a released runner says to a Turn: the engine hands its runs to the next one. */
export const RELEASED = "Night Shift is restarting. Try again in a moment.";
/**
 * Why a run failed when its walk broke on an error that is not a refusal.
 * The error itself goes to the log.
 */
export const ENGINE_FAILED =
	"Something went wrong in Night Shift. It saved the details. Resume the run to try again.";
