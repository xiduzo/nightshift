import type { FlowNode } from "@nightshift/flows";
import type {
	NodeToPlace,
	OwnDevice,
	Placement,
	StartRunInput,
} from "../../../contract";
import type { Device } from "../../../device";
import type { RunRow, RunState } from "../../../log";
import type { PlanInput, PlannedRun } from "../../../placement";
import type { RunSummary } from "../../../read";
import type { NewRun } from "./start-run-here";

/**
 * The driven ports of the start. Each is the start's own, with a real
 * adapter, an in-memory adapter and a contract suite in `adapters/out/`.
 * The start also takes what is not its own, by its owner's type: the
 * projects, the Turns, the facts and the start holds of the walk, and
 * the pure rules of the walk and the log.
 */

/** Where a run's steps run: its plan, and the Devices a person may choose. */
export type RunPlanner = {
	/**
	 * Plans a run at its start (`PlacementPort.plan`): the Person it runs
	 * for, its Device and each node's, and the flows from that Device's
	 * Clone. The project's latest run's Device is the first last resort.
	 * Throws the refusal when the run cannot run there.
	 */
	plan(input: Omit<PlanInput, "lastRun">): Promise<PlannedRun>;
	/** The requirement the Device fails for the nodes placed on it, as a person reads it, or null. */
	misfit(nodes: readonly FlowNode[], device: Device): Promise<string | null>;
	/** The Devices a run of the project can run on: online, with a Clone. */
	placements(
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<Placement[]>;
	/** The Devices a Person may place a run's steps on. With `forNode`, those that node may name. */
	devicesFor(
		spaceId: string,
		personId: string,
		projectId: string,
		forNode?: NodeToPlace,
	): Promise<OwnDevice[]>;
	/** The Device the project's latest run ran on, or null. */
	lastRunDevice(projectId: string): Promise<string | null>;
};

/** Who keeps a Space: this Replica, or a Host this computer may reach. */
export type SpaceKeeper = {
	/** Whether a Host keeps the Space, not this Replica. */
	hostedElsewhere(spaceId: string): Promise<boolean>;
	/** Whether this computer reaches the Host that keeps the Space now. */
	reachable(spaceId: string): Promise<boolean>;
	/** The Host that keeps the Space, or null when this Replica keeps it. */
	hostOf(spaceId: string): Promise<string | null>;
};

/** The starts this computer hands to the Host that keeps a Space: the Host walks the run. */
export type HostStarts = {
	/** Has the Host start the run. Throws `HostUnreachableError` when no Host can take it. */
	start(input: StartRunInput & { spaceId: string }): Promise<{ runId: string }>;
	/**
	 * Waits until the run's row and its first event reached this Replica,
	 * and the run list of its project shows it. Null when that took too
	 * long: the run started, and it shows in the list later.
	 */
	arrived(run: {
		runId: string;
		spaceId: string;
		projectId: string;
	}): Promise<RunSummary | null>;
};

/** The runs this computer starts, and the runs a test run's pins name. */
export type NewRuns = {
	/**
	 * Writes the run's row and its `RunStarted` in one batch: both land, or
	 * neither does. Returns the row.
	 */
	started(run: NewRun): Promise<RunRow>;
	/** The run a pin names, with its project and Space and its state, or null when this Replica has no such run. */
	pinned(runId: string): Promise<{
		run: Pick<RunRow, "projectId" | "spaceId">;
		state: RunState;
	} | null>;
};

/** Who starts a run, as its worktree and its summary name them. */
export type Starters = {
	/** The git identity a Person's runs commit as. Null for a Person without a real email. */
	gitAuthor(personId: string): Promise<{ name: string; email: string } | null>;
	/** The run as the run list shows it once it started: its Person's name, this computer as its Walker, and its Device. */
	summary(
		run: RunRow,
		device: { id: string; name: string },
	): Promise<RunSummary>;
};
