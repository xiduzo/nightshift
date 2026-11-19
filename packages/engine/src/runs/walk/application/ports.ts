import type { Actor, RunCommandInput, RunCommandKind } from "../../../contract";
import type { Held, Intent, Taken, TakeOptions } from "../../../graph";
import type {
	EngineEventType,
	EnginePayloads,
	LoggedEvent,
	RunRow,
	RunState,
} from "../../../log";

/**
 * The driven ports every use case that writes to a run shares: the run's
 * facts, its Turns and the Walker of a run another Device walks. Each is
 * the walk's own, with a real adapter, an in-memory adapter and a contract
 * suite in `adapters/out/`.
 */

/** The facts of a run: its log and its state, as this Replica has them. */
export type RunFacts = {
	/** The run's state: one fold of its log, as of its latest event. */
	state(runId: string): Promise<RunState>;
	/** The run's events, in seq order. */
	events(runId: string): Promise<LoggedEvent[]>;
	/** Appends one event as this Walker's next, and returns it as logged. */
	append<T extends EngineEventType>(event: {
		type: T;
		payload: EnginePayloads[T];
		runId: string;
		stepId?: string | null;
		sessionId?: string | null;
	}): Promise<LoggedEvent>;
	/** Tells the run's watchers that its status changed. */
	changed(runId: string): void;
	/** This computer's id as the Walker of its runs. */
	walkerId(): Promise<string>;
};

/**
 * The Turns of a run (the runner's): one at a time per run, first in
 * first out. A rule that reads the log runs inside the Turn (`check`), so
 * no other Turn comes between the rule and the action.
 */
export type Turns = {
	/** Takes the run for one Turn: what `intent` asks. */
	take(runId: string, intent: Intent, options?: TakeOptions): Promise<Taken>;
	/** A Turn that drives nothing: `work` sees the run's row, its state, and whether a drive holds it. */
	hold<T>(
		runId: string,
		work: (held: Held) => Promise<T>,
		options?: { arrival?: boolean },
	): Promise<T>;
	/** Drops what the runner keeps of a run another Device walks now. */
	forget(runId: string): void;
	/** Whether a drive or a Turn holds a slot of the run. */
	isActive(runId: string): boolean;
	/** Sets the wake timer of a run from its state: a new daemon's, or a moved-in run's. */
	restore(runId: string, state: RunState): void;
	/** A run moved here: its transcript continues after `seq`, the last entry its old Walker wrote. */
	continueTranscriptAfter(runId: string, seq: number): void;
};

/** The Walkers of the runs another Device walks: an action there travels as a Command. */
export type Walkers = {
	/**
	 * Hands a Command to the Walker of a run another Device walks, in the
	 * Person's name. Throws `walker-unreachable` when no Host can take it,
	 * and `signed-out` when no Person acts.
	 */
	send(
		run: Pick<RunRow, "id" | "spaceId" | "walkerId">,
		actor: Actor,
		command: RunCommandInput,
	): Promise<void>;
	/** The kinds of the Commands that wait for the run's Walker. */
	pending(runId: string): Promise<readonly RunCommandKind[]>;
};
