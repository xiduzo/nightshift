import type { OwnDevice, PersonActor } from "../../../contract";
import type { LoggedEvent, RunRow } from "../../../log";

/**
 * The driven ports of the move that are its own: the Person's Devices a
 * run moves to, and the hand-over of its walk state between two Walkers.
 * Each has a real adapter, an in-memory adapter and a contract suite in
 * `adapters/out/`. The ports every use case that writes to a run shares
 * (the run's facts, its Turns, its Walker) are those of `runs/walk`.
 */

/** The Person's Devices, as a move of a run's walk asks the planner of its Space. */
export type MoveDevices = {
	/**
	 * One of the Person's own Devices, not this computer, online: where the
	 * run's walk can go. Null when it is not one of theirs. Throws the
	 * planner's refusal when it is offline.
	 */
	target(
		run: RunRow,
		person: PersonActor,
		deviceId: string,
	): Promise<{ id: string; name: string } | null>;
	/**
	 * What the target says it walks: the newest flow format it reads (one
	 * that does not say reads format 8), and whether it walks test runs.
	 */
	capabilities(
		target: { id: string; name: string },
		run: RunRow,
	): Promise<{ flowVersion: number; testRuns: boolean }>;
	/** The Devices the Person may place the run's steps on: their own, online or not, then others' through Offers. */
	own(
		run: Pick<RunRow, "spaceId" | "projectId">,
		person: PersonActor,
	): Promise<OwnDevice[]>;
};

/** A run's walk state as it goes from one Walker to the next, through the archive of the Replica that keeps its Space. */
export type WalkHandover = {
	/**
	 * Keeps the walk state of a run this computer walks (its Checkpoint and
	 * each step's files) in the archive: what the next Walker takes it over
	 * from. Throws when the Host that keeps the Space cannot be reached.
	 */
	keep(runId: string): Promise<void>;
	/** The run's row follows a `WalkerMoved` of its log: its Walker is the move's `to`. It repeats safely. */
	moved(event: LoggedEvent): Promise<void>;
	/** Whether the run moved to this computer and has not arrived yet: nothing of this computer is in its log since. */
	arriving(runId: string): Promise<boolean>;
	/** Brings the run's Checkpoint from the archive into this computer's walk state. False: the archive has none. */
	takeCheckpoint(run: Pick<RunRow, "id" | "spaceId">): Promise<boolean>;
	/**
	 * Brings each step's transcript from the archive into the step's file
	 * on this computer, unless that file goes as far already. Returns the
	 * last seq the archive's copies hold, 0 without any.
	 */
	takeTranscripts(run: Pick<RunRow, "id" | "spaceId">): Promise<number>;
};
