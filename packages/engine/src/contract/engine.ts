import type {
	Flow,
	FlowIssue,
	FlowListItem,
	JsonValue,
	LoadedFlow,
	Schedule,
	ScheduleIssue,
} from "@nightshift/flows";
import type { Artifact } from "../artifacts";
import type { FlowUse } from "../flows";
import type { LandedRunListener } from "../log";
import type { Branches, Project } from "../projects";
import type { OpenGate, RunDetail, RunStreamItem, RunSummary } from "../read";
import type { ScheduleList } from "../schedules";
import type { OwnDevice, Placement } from "./peers";

/**
 * The engine's public contract: `Engine`, and the view of one Space,
 * `SpaceEngine`. A run walks a flow, and the flows it calls, in one worktree.
 */

/**
 * The engine of this Device. Its background work (the walk, recovery, the
 * scheduler) covers every Space the Device holds, and writes each row with
 * its own Space. What a person does goes through one Space's view.
 */
export interface Engine {
	/**
	 * What a person does in one Space. Nothing it reads, returns or changes
	 * is of another Space: a project or run of another Space is "not found".
	 * `actor` is the Person who acts: an action on a run walked elsewhere
	 * travels to its Walker in their name.
	 */
	space(spaceId: string, actor?: Actor): SpaceEngine;
	/**
	 * The Space of a run this computer keeps, or null when it has none of
	 * that id. Who may see or act on the run there is the caller's check:
	 * then it goes through that Space's view.
	 */
	spaceOfRun(runId: string): Promise<string | null>;
	/**
	 * Logs a change of a Space's Members in that Space's event log
	 * (`MemberJoined`, `MemberRemoved`, `MemberRoleChanged`), with who made it.
	 */
	logMemberChange(change: MemberChange): Promise<void>;
	/**
	 * Calls `listener` with the run events that land in this Replica from
	 * now on: appended here, or brought by the exchange from another
	 * Walker. Each carries its run's Space. The notifier reads Gates and
	 * run endings from it. Returns the unsubscribe.
	 */
	onRunEvents(listener: LandedRunListener): () => void;
	/**
	 * A Device is back (its link to this Host took work again): the steps
	 * of the runs this computer walks that sleep because a Device was
	 * offline look again now, instead of at their next try.
	 */
	deviceBack(deviceId: string): Promise<void>;
	/**
	 * Hands this computer's runs over to a new engine in the same process
	 * (`bun --hot` evaluates the daemon again). Stops the scheduler, the
	 * resumes and the wake timers, and lets go of every run this engine
	 * drives: each drive writes nothing more and its harness is aborted.
	 * The log is left as it is, so the next engine's recovery finds the
	 * open work, ends it `interrupted` and continues it, as after a
	 * restart. Resolves once the drives' writes in flight settled.
	 */
	dispose(): Promise<void>;
}

/** A change of a Space's Members, as the auth hooks report it. */
export type MemberChange =
	| {
			kind: "joined";
			spaceId: string;
			personId: string;
			role: string;
			by: string | null;
			invitedBy?: string;
	  }
	| { kind: "removed"; spaceId: string; personId: string; by: string | null }
	| {
			kind: "role";
			spaceId: string;
			personId: string;
			role: string;
			previousRole: string;
			by: string | null;
	  };

/** The engine as a person in one Space sees it: the API layer only calls this. */
export interface SpaceEngine {
	listProjects(): Promise<Project[]>;
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
	 * whether it is online and has a Clone (a node's Device picker).
	 */
	listDevices(projectId: string): Promise<OwnDevice[]>;

	/** The local and remote branches of the project's clone, newest first. A run can start from one. */
	listBranches(projectId: string): Promise<Branches>;

	/**
	 * The flow files in the project's clone, `.nightshift/flows/*.json`:
	 * this computer's, else the Clone of another of the actor's Devices
	 * (read-only here).
	 */
	listFlows(projectId: string): Promise<FlowListItem[]>;
	getFlow(projectId: string, name: string): Promise<LoadedFlow>;
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

	listRuns(input?: { projectId?: string }): Promise<RunSummary[]>;
	getRun(runId: string): Promise<RunDetail>;
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
	 * (inside a Call with `each`, at the same item). A sleeping run wakes at once.
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
	 * Emits the current status and every step summary, replays the full
	 * transcript in `seq` order (from this computer's files or the
	 * archive), then yields live items until the signal aborts. `afterSeq`
	 * skips transcript entries the caller already has. It throws when the
	 * transcript cannot be read: the caller watches again from its cursor.
	 */
	watchRun(
		runId: string,
		options: { signal: AbortSignal; afterSeq?: number },
	): AsyncIterable<RunStreamItem>;
}

/** Who acts in a Space: the Person of the session. */
export type Actor = { personId: string };

export type StartRunInput = {
	projectId: string;
	/**
	 * Values for the flow's `inputs`, by name: a string for a `text` input,
	 * any JSON value (or JSON text) for a `json` input. A missing or empty
	 * value takes the input's default; a required input without either
	 * refuses the start. Names the flow does not declare are refused.
	 */
	inputs?: Record<string, JsonValue>;
	/** Epoch ms. No new step starts after it; the run then ends as stopped. */
	stopAt?: number;
	/** Git ref to branch the worktree from. Defaults to the clone's current HEAD. */
	baseRef?: string;
	/**
	 * The Person who starts the run (their id). Commits in the run's
	 * worktree are in their name. Absent: a schedule, or nobody known.
	 */
	startedBy?: string;
	/**
	 * The Device the run's steps run on, and its worktree's home (its
	 * Placement): one of the starter's Devices with a Clone of the project
	 * (`listPlacements`). Default: this computer.
	 */
	deviceId?: string;
} & (
	| { flowName: string; flow?: never }
	/** A flow that is not a file, for example a quick run. */
	| { flow: Flow; flowName?: never }
);
