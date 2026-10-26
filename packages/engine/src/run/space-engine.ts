import type {
	Flow,
	FlowIssue,
	FlowListItem,
	LoadedFlow,
	ProjectFlowMap,
	Schedule,
	ScheduleIssue,
} from "@nightshift/flows";
import type { Artifact } from "../artifacts";
import type { RunCopies } from "../cleanup";
import type {
	NodeToPlace,
	OwnDevice,
	Placement,
	StartRunInput,
} from "../contract";
import type { FlowUse } from "../flows";
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
import type { ScheduleList } from "../schedules";

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
	 * The flow files in the project's clone, `.nightshift/flows/*.json`:
	 * this computer's, else the Clone of another of the actor's Devices
	 * (read-only here).
	 */
	listFlows(projectId: string): Promise<FlowListItem[]>;
	getFlow(projectId: string, name: string): Promise<LoadedFlow>;
	/** Every flow file of a project by name: its flow, null when it does not load. One read for the editor. */
	flowMap(projectId: string): Promise<ProjectFlowMap>;
	/** Saves drafts with errors too. Returns the issues of the saved flow. */
	saveFlow(projectId: string, name: string, flow: Flow): Promise<FlowIssue[]>;
	deleteFlow(projectId: string, name: string): Promise<void>;
	/**
	 * Who uses what, from every flow of the Space's projects: the flows that
	 * name each connection and CLI tool, and the Agent nodes that name each
	 * profile. A flow that cannot be read uses nothing.
	 */
	flowUse(): Promise<FlowUse>;

	/** Open Gates over the Space's runs, oldest first. The Needs-you inbox. A Gate stays open across daemon restarts. */
	listGates(): Promise<OpenGate[]>;

	/**
	 * The schedules of `.nightshift/schedules.json` in the project's clone,
	 * with the next start and how the last cron time went.
	 */
	listSchedules(projectId: string): Promise<ScheduleList>;
	/**
	 * Writes the schedules file. Saves schedules with problems too; returns
	 * the issues. The scheduler reads the file on its next tick.
	 */
	saveSchedules(
		projectId: string,
		schedules: readonly Schedule[],
	): Promise<ScheduleIssue[]>;
	/**
	 * Answers an open Gate with one of its choices and continues the walk on
	 * that outcome. Fails when the step is not an open Gate or the choice is
	 * not one of its choices.
	 */
	resolveGate(input: {
		runId: string;
		stepId: string;
		choice: string;
		note?: string;
	}): Promise<void>;
	/**
	 * Sends a signal to a run whose Wait node waits for it: the step ends
	 * `done` and the walk goes on. Fails when the run does not wait for a
	 * signal of that name.
	 */
	signalRun(runId: string, name: string): Promise<void>;

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

	// The run actions (`run/actions.ts`). Each one refuses what the run does
	// not allow now (`run-status/`, the rule the screens read too) with a
	// `RunRefusal`. On a run another Device walks, a stop, an answer, a
	// signal and a move travel to its Walker; the rest are refused.

	/**
	 * `now` (default): aborts the running step, closes an open Gate or ends a
	 * sleep, and ends the run as `stopped`. `after-step`: lets the running
	 * step finish, then ends the run as `stopped` before the next step.
	 * `cancel-after-step`: withdraws an `after-step` stop.
	 * No-op when nothing runs, waits or sleeps.
	 */
	stopRun(
		runId: string,
		options?: { when?: "now" | "after-step" | "cancel-after-step" },
	): Promise<void>;
	/**
	 * Continues a stopped, failed or interrupted run at its last step's node
	 * (inside a Call with `each`, at the same item). A finished run reopens
	 * its last step. A sleeping run wakes at once.
	 * An Agent node with a harness session continues that session with the
	 * prompt (default "Continue where you left off."). Any other node runs
	 * again. Edge counts carry over. Fails while the run is running.
	 */
	resumeRun(runId: string, prompt?: string): Promise<void>;
	/**
	 * Stops the running step and continues it at once, in one action: as a
	 * stop now and a resume would, with nothing in between. An Agent step
	 * with a harness session continues it with the prompt (default
	 * "Continue where you left off."); any other step runs again. Only
	 * while a step runs; with `stepId`, only while that step runs. A run
	 * another Device walks is refused.
	 */
	restartStep(
		runId: string,
		options?: { prompt?: string; stepId?: string },
	): Promise<void>;
	/**
	 * Walks a run that is not going (failed, stopped, interrupted or
	 * finished) again from `nodeId`, a node of the run's own flow, with a
	 * new visit of it; the steps after it follow as the flow routes. Inputs,
	 * outputs and edge counts carry over. An Agent node continues the
	 * session of its step `stepId` (default: its latest) with the prompt
	 * (default "Continue where you left off."), or with `fresh` starts a
	 * new session with its own prompt. A run another Device walks is
	 * refused.
	 */
	rerunFrom(
		runId: string,
		options: {
			nodeId: string;
			stepId?: string;
			prompt?: string;
			fresh?: boolean;
		},
	): Promise<void>;
	/**
	 * Moves the run's Walk to another of the actor's Devices (`WalkerMoved`):
	 * this computer archives the run's checkpoint and files and stops
	 * walking it; the new Walker resumes from the archive. Only a run that
	 * is not in the middle of a step. A run walked elsewhere: its Walker
	 * moves it.
	 */
	moveRun(runId: string, toDeviceId: string): Promise<void>;
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
