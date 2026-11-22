import type { Actor } from "../../contract";
import type { RunStatus } from "../../run-status";
import type { RunFile } from "../domain/run-files";
import type { RunCopyState, WorktreeRemoved } from "../domain/safety";

/**
 * The driven ports of the cleanup. One is its own, with a real adapter, an
 * in-memory adapter and a contract suite in `adapters/out/`: `RemovalLog`.
 * Another vertical fills the others (`@filledBy`): the engine's
 * composition passes them to `wireCleanup`.
 */

/**
 * Who may see a run: the one check of a request a person makes about a
 * run (`openRun` of the engine's `runs`).
 * @filledBy engine/runs
 */
export type CleanupAccess = {
	/**
	 * Refuses an actor who may not see the run, or a run of another Space
	 * than the one asked for (`RunNotFound`). Night Shift itself may open
	 * every run.
	 */
	openRun(
		actor: Actor,
		request: { runId: string; spaceId?: string },
	): Promise<unknown>;
};

/**
 * What the cleanup reads of the runs of this computer.
 * @filledBy engine/wire
 */
export type CleanupRuns = {
	/** The project's runs in the Space, newest first. */
	listRuns(
		spaceId: string,
		projectId: string,
	): Promise<
		{
			id: string;
			status: RunStatus;
			createdAt: number;
			endedAt: number | null;
			baseRef: string;
		}[]
	>;
	/** The run's status, or null for a run the log has nothing on. */
	runStatus(runId: string): Promise<RunStatus | null>;
	/** The run's row. Refuses (`not-found`) a run this computer does not know. */
	runRow(runId: string): Promise<{ projectId: string; createdAt: Date }>;
	/** The run's state, folded from its log. */
	runState(runId: string): Promise<{
		status: RunStatus;
		end: { at: number } | null;
		runFolder: boolean;
	}>;
	/** A step of the run is at work in this process. */
	isActive(runId: string): boolean;
};

/**
 * The projects with a Clone on this computer.
 * @filledBy engine/projects
 */
export type CleanupProjects = {
	list(): Promise<{ id: string; spaceId: string; repoPath: string }[]>;
};

/**
 * The clock, and the switch of the cleanup with its days.
 * @filledBy engine/wire
 */
export type CleanupGround = {
	now(): number;
	settings(): { cleanUpRuns: boolean; cleanUpAfterDays: number };
};

/**
 * The run worktrees and branches of the clones on this computer, and the
 * kept refs where the cleanup keeps work that is only here.
 * @filledBy engine/git
 */
export type RunBranches = {
	/** What each run left in the clone at `repoPath`, by short id. */
	inspect(
		repoPath: string,
		runs: readonly { shortId: string; baseRef: string }[],
	): Promise<Map<string, RunCopyState>>;
	/** The kept refs of the clone, by short id. */
	listKept(repoPath: string): Promise<Map<string, string[]>>;
	/** Commits the changes of the worktree at `cwd` without moving a branch. Returns the commit. */
	commitChanges(cwd: string, message: string): Promise<string>;
	/** Points the ref `ref` at `commit`. */
	keep(repoPath: string, ref: string, commit: string): Promise<void>;
	/** Deletes the ref `ref` (a kept ref). */
	deleteRef(repoPath: string, ref: string): Promise<void>;
	/** Removes the worktree. Git refuses one with changes unless `force`. */
	removeWorktree(
		repoPath: string,
		worktreePath: string,
		options?: { force?: boolean },
	): Promise<void>;
	/** Deletes a local branch. Never a remote branch. */
	deleteBranch(repoPath: string, name: string): Promise<void>;
	/** Forgets the worktrees whose folder is gone. */
	prune(repoPath: string): Promise<void>;
	/** The kept refs of one run: of its copy, and of each of its branches. */
	keptRefs(shortId: string): { copy: string; branch(name: string): string };
};

/**
 * The run folders on this computer: where runs of projects without a
 * folder work (ADR 22).
 * @filledBy engine/run-folders
 */
export type RunFolderFiles = {
	/** The run's folder on this computer. */
	path(runId: string): string;
	/** The ids of the runs with a folder on this computer. */
	runIds(): Promise<string[]>;
	/** The files of the run's folder, by path. Null when the folder is not here. */
	list(runId: string): Promise<{ files: RunFile[]; more: boolean } | null>;
	/** One file of the run's folder and where it is. Null when there is none at that path. Refuses a path that is not one. */
	file(
		runId: string,
		path: string,
	): Promise<{ file: RunFile; path: string } | null>;
	/** When something in the run's folder last changed. Null when it is not here. */
	lastChange(runId: string): Promise<number | null>;
	/** Removes the run's folder and its files. */
	remove(runId: string): Promise<void>;
};

/** The removals of what runs left on this computer, as the log keeps them (`WorktreeRemoved`). */
export type RemovalLog = {
	/** Logs one removal, its fields in their order. */
	removed(removal: WorktreeRemoved): Promise<void>;
	/** The project's removals on this computer, oldest first. */
	removals(
		projectId: string,
	): Promise<{ at: number; runId: string; by: "person" | "cleanup" }[]>;
};
