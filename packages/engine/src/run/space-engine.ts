import type { Schedule, ScheduleIssue } from "@nightshift/flows";
import type { Artifact } from "../artifacts";
import type { RunCopies } from "../cleanup";
import type {
	NodeToPlace,
	OwnDevice,
	Placement,
	StartRunInput,
} from "../contract";
import type { FlowUse, SpaceFlows } from "../flows";
import type { Branches, Project } from "../projects";
import type {
	OpenGate,
	ProjectRuns,
	RunDetail,
	RunPage,
	RunStreamItem,
	RunSummary,
	StepDetail,
} from "../read";
import type { ScheduleList, SchedulePause } from "../schedules";
import type { KeptValue } from "../variables";
import type { RunActionRequest } from "./actions";

/** The engine as a person in one Space sees it: the API layer only calls this. */
export interface SpaceEngine {
	listProjects(): Promise<Project[]>;
	/** How the runs of each project stand, by project id. A project without runs is not in it. */
	projectRuns(): Promise<Map<string, ProjectRuns>>;
	/**
	 * Fails when the path is not the top level of a git repository. A
	 * repository without commits is added; `checkProjectFolder` says what it
	 * still needs, and runs refuse to start until then.
	 */
	addProject(input: { repoPath: string; name?: string }): Promise<Project>;
	/** Keeps the project's runs and events. Fails while one of its runs is running. */
	removeProject(projectId: string): Promise<void>;
	/** Gives the project a new name, for every Member of the Space. */
	renameProject(projectId: string, name: string): Promise<Project>;
	/**
	 * Moves the project to another Space, with its Clones, runs, steps,
	 * sessions and events. Who may move it (in both Spaces) is the caller's
	 * check. Fails while one of its runs is running.
	 */
	moveProject(projectId: string, toSpaceId: string): Promise<void>;

	/**
	 * The Devices a run of the project can run on, for the actor: this
	 * computer when it has a Clone, then their other Devices that are
	 * online and have one. In a Space a Host keeps, the Host answers.
	 */
	listPlacements(projectId: string): Promise<Placement[]>;
	/**
	 * The actor's Devices for a project: this computer first, each with
	 * whether it is online and has a Clone, then other Persons' that offer
	 * profiles to the Space. With `forNode`, the Devices a node may name
	 * (a node's Device picker): another Person's only when the actor may
	 * run the node's profile there through its Offers.
	 */
	listDevices(projectId: string, forNode?: NodeToPlace): Promise<OwnDevice[]>;

	/** The local and remote branches of the project's clone, newest first. A run can start from one. */
	listBranches(projectId: string): Promise<Branches>;

	/**
	 * The project's runs with a worktree or local branches left on this
	 * computer, newest first: whether each is merged into the default
	 * branch, pushed, or has work that is only here. Also the runs whose
	 * leftovers were removed. Read-only, no fetch.
	 */
	listRunCopies(projectId: string): Promise<RunCopies>;
	/**
	 * Removes the run's worktree on this computer; its branches stay.
	 * Refuses a run that is still open, and a worktree with changes that
	 * are not committed unless `force`.
	 */
	removeRunCopy(runId: string, options?: { force?: boolean }): Promise<void>;
	/**
	 * Deletes the run's local branches on this computer, never a branch on
	 * origin. Refuses while its worktree is there, a run that is still
	 * open, and commits that are only on this computer unless `force`.
	 */
	deleteRunBranches(
		runId: string,
		options?: { force?: boolean },
	): Promise<void>;

	/**
	 * The flows of the Space's projects, for the actor: list, read, save,
	 * remove, their notices and revisions, a restore, export, import and
	 * copy (`flows/space-flows.ts`). From each project's flow document:
	 * every Device has them, with or without a Clone.
	 */
	readonly flows: SpaceFlows;
	/**
	 * The values the flow's kept variables (`keep`) have between runs on
	 * this computer, by name. A variable without one starts from `initial`.
	 */
	listKeptValues(projectId: string, flowName: string): Promise<KeptValue[]>;
	/** Forgets one kept value: the next run starts the variable from `initial`. */
	resetKeptValue(
		projectId: string,
		flowName: string,
		name: string,
	): Promise<void>;
	/**
	 * Who uses what, from every flow of the Space's projects: the flows that
	 * name each connection and CLI tool, and the Agent nodes that name each
	 * profile. A flow that cannot be read uses nothing.
	 */
	flowUse(): Promise<FlowUse>;

	/** Open Gates over the Space's runs, oldest first. The Needs-you inbox. A Gate stays open across daemon restarts. */
	listGates(): Promise<OpenGate[]>;

	/**
	 * The schedules of the project, from its flow document, with the next
	 * start and how the last cron time went.
	 */
	listSchedules(projectId: string): Promise<ScheduleList>;
	/**
	 * Pauses one schedule tonight: its next start and every start until
	 * 06:00 after it, on its clock, start no run. Then it starts as before.
	 * Refuses a schedule that is off, has a webhook or has no next start.
	 */
	pauseScheduleTonight(
		projectId: string,
		scheduleId: string,
	): Promise<SchedulePause>;
	/** Ends one schedule's pause tonight. */
	resumeScheduleTonight(
		projectId: string,
		scheduleId: string,
	): Promise<SchedulePause>;
	/**
	 * Starts one schedule's run now, as if it fired now: its flow, inputs,
	 * Device and Person, with the schedule as the trigger. For the actor
	 * when the schedule names no Person. Refuses while an earlier run of
	 * it is open.
	 */
	runScheduleNow(projectId: string, scheduleId: string): Promise<RunSummary>;
	/**
	 * Saves the schedules. Saves schedules with problems too; returns the
	 * issues. The scheduler reads them on its next tick. `timeZone` is the
	 * saver's clock: a schedule with a time and no time zone gets it.
	 */
	saveSchedules(
		projectId: string,
		schedules: readonly Schedule[],
		timeZone?: string,
	): Promise<ScheduleIssue[]>;
	/**
	 * The Space's runs (of one project), newest first. With `limit`, a page
	 * of them, after the run of `cursor`.
	 */
	listRuns(input?: { projectId?: string } & RunPage): Promise<RunSummary[]>;
	getRun(runId: string): Promise<RunDetail>;
	/**
	 * One step of a run with what the run's summary of it leaves out: the
	 * prompt of each session and the element of each item.
	 */
	getStep(runId: string, stepId: string): Promise<StepDetail>;
	/**
	 * The files the run's agents kept for the person, oldest first. Only
	 * the ones kept on this computer.
	 */
	listArtifacts(runId: string): Promise<Artifact[]>;
	/** One artifact of the run and where its file is, or null when there is none of that id. */
	artifactFile(
		runId: string,
		artifactId: string,
	): Promise<{ artifact: Artifact; path: string } | null>;

	/**
	 * Validates the flow (refuses one with errors), snapshots it, creates the
	 * worktree, starts walking at the start node, and returns at once.
	 */
	startRun(input: StartRunInput): Promise<RunSummary>;

	/**
	 * What the person asks of a run (`run/actions.ts`): stop it, answer its
	 * Gate, send its signal, move its Walk, resume it, restart its step or
	 * walk it again from a node. Each action refuses what the run does not
	 * allow now (`run-status/`, the rule the screens read too) with a
	 * `RunRefusal`. On a run another Device walks, a stop, an answer, a
	 * signal and a move travel to its Walker; the rest are refused.
	 */
	act(runId: string, request: RunActionRequest): Promise<void>;
	/**
	 * The actor's own Devices the run can move to now: online, and not its
	 * Walker. From the run's own Space, whichever Space the person works in.
	 */
	listMoveTargets(runId: string): Promise<OwnDevice[]>;

	/**
	 * Emits the current status and every step summary, replays the full
	 * transcript in `seq` order (from this computer's files or the
	 * archive), then yields live items until the signal aborts. `afterSeq`
	 * skips transcript entries the caller already has. It throws when the
	 * transcript cannot be read: the caller watches again from its cursor.
	 * The transcript has its own reader: its last entries can come after
	 * the status that ends the run, so a watcher reads on after it.
	 */
	watchRun(
		runId: string,
		options: { signal: AbortSignal; afterSeq?: number },
	): AsyncIterable<RunStreamItem>;
}
