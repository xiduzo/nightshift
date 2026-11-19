import type { Actor } from "../../../contract";
import type { RunRow } from "../../../log";
import type {
	AnsweredGate,
	OpenGate,
	ProjectRuns,
	RunDetail,
	RunPage,
	RunStreamItem,
	RunSummary,
	RunTrace,
	StepDetail,
	StepTranscript,
} from "../../../read";
import type { RunStatus } from "../../../run-status";
import type { RunHere } from "./read-run-here";

/**
 * What people see of the runs of this Replica, derived from the event
 * log. Each read of one run takes the run's row: the caller opened it.
 */
export type RunViews = {
	/**
	 * The Space's runs (of one project), newest first, with the facts the
	 * log gives each one. With `page`, at most `limit` of them with one of
	 * its `statuses`, after its `cursor`.
	 */
	listRuns(
		spaceId: string,
		projectId?: string,
		page?: RunPage,
	): Promise<RunSummary[]>;
	/** How the runs of each project of the Space stand, by project id. Default: now, in UTC. */
	projectRuns(
		spaceId: string,
		read?: { now: number; timeZone: string },
	): Promise<Map<string, ProjectRuns>>;
	/** The run page. */
	getRun(row: RunRow): Promise<RunDetail>;
	/** One step of the run with its prompts and the elements of its items, or "not found". */
	getStep(row: RunRow, stepId: string): Promise<StepDetail>;
	/** One step's transcript as Night Shift saved it. Aborting `signal` ends the read with what came. */
	stepTranscript(
		row: RunRow,
		stepId: string,
		signal: AbortSignal,
	): Promise<StepTranscript>;
	/** The run's status, or null for a run the log has nothing on. */
	runStatus(runId: string): Promise<RunStatus | null>;
	/** Where a run is and what it does, cheap. Null when this Replica has no such run. */
	runHere(runId: string): Promise<RunHere | null>;
	/** The run as monitoring reads it, or null when the log has none of it. */
	trace(runId: string): Promise<RunTrace | null>;
	/** The open Gates of the Space's runs of projects a person has not removed, in the inbox order. */
	listGates(spaceId: string): Promise<OpenGate[]>;
	/** The Gates of the Space's runs that closed after `since`, newest first. */
	listAnsweredGates(spaceId: string, since: number): Promise<AnsweredGate[]>;
	/**
	 * The run's status, its steps and its transcript after `afterSeq`, then
	 * every change as it happens, until `signal` aborts.
	 */
	watch(
		row: RunRow,
		signal: AbortSignal,
		afterSeq: number,
	): AsyncGenerator<RunStreamItem>;
};

/** A run's page with the worktree fields a Person may not see. */
type WithPaths = {
	device: { id: string; thisDevice: boolean };
	worktreePath: string;
	takeOverCommand?: string | null;
};

/**
 * Hides the worktree paths of runs on Devices the actor does not own:
 * the path stays with the Device's owner. Night Shift sees every path.
 * @filledBy devices
 */
export type PrivatePaths = {
	for(
		spaceId: string,
		actor: Actor,
	): Promise<<T extends WithPaths>(view: T) => Promise<T>>;
};
