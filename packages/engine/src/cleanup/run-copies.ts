import type { Database } from "@nightshift/db";
import { Refusal } from "@nightshift/refusal";
import {
	RUN_NOT_FOUND,
	type RunLog,
	type RunRow,
	type RunStatus,
	worktreeRemovals,
} from "../log";
import type {
	Projects,
	RunBranches,
	RunBranchState,
	RunCopyState,
} from "../projects";
import { isOpenStatus, type RunSummary } from "../read";
import {
	cleanupTime,
	hasLeftovers,
	isSafeToRemove,
	unsavedCommits,
} from "./safety";

/**
 * What runs left in a project's clone on this computer, and their
 * removal: the overview a person reads, the two actions they take, and
 * the scheduled sweep. A run that is still open (running, waiting at a
 * Gate, asleep) is never touched. Every removal is logged as
 * `WorktreeRemoved`. Remote branches are never touched.
 */

/** One run's worktree and branches on this computer. */
export type RunCopy = {
	runId: string;
	title: string;
	status: RunStatus;
	/** Running, waiting or sleeping: nothing removes its copy or branches. */
	active: boolean;
	createdAt: number;
	endedAt: number | null;
	/** The run's own copy of the project (its worktree) is on this computer. */
	copy: boolean;
	/** Files in the copy that are changed and not committed. Null when git could not tell. */
	changes: number | null;
	/** Its local branches: the run's own, then its Item Branches. */
	branches: RunBranchState[];
	/** Removing the copy and the branches loses nothing. */
	safe: boolean;
	/** When the scheduled cleanup removes it. Null when it never will on its own. */
	cleanupAt: number | null;
	/** The latest removal on this computer, by a person or the cleanup. */
	removed: { at: number; by: "person" | "cleanup" } | null;
};

/** The runs of a project with something left on this computer, newest first. */
export type RunCopies = {
	/** The branch that "merged" means: `origin/HEAD`, else `main` or `master`. */
	defaultBranch: string | null;
	copies: RunCopy[];
};

/** What the sweep did. */
export type SweepResult = { removed: string[]; kept: number };

export type RunCopiesDeps = {
	db: Database;
	/** Appends `WorktreeRemoved`. */
	log: Pick<RunLog, "append">;
	branches: RunBranches;
	projects: Pick<Projects, "get" | "list">;
	/** The project's runs in the Space, newest first. */
	listRuns(spaceId: string, projectId: string): Promise<RunSummary[]>;
	runRow(runId: string): Promise<RunRow>;
	runStatus(runId: string): Promise<RunStatus | null>;
	/** A step of the run is at work in this process. */
	isActive(runId: string): boolean;
	now(): number;
	settings(): { cleanUpRuns: boolean; cleanUpAfterDays: number };
};

const shortIdOf = (runId: string) => runId.slice(0, 8);

const commits = (n: number) => (n === 1 ? "1 commit" : `${n} commits`);

export function createRunCopies(deps: RunCopiesDeps) {
	const { branches, projects } = deps;

	/** Throws when the run is open: nothing removes the work of a run that goes on. */
	async function refuseOpen(runId: string): Promise<void> {
		const status = await deps.runStatus(runId);
		if (deps.isActive(runId) || (status && isOpenStatus(status))) {
			throw new Refusal(
				"conflict",
				"This run is still going. Wait until it ends, or stop it first.",
			);
		}
	}

	/** The run (of the Space), its clone here, and what it left there. */
	async function stateOf(spaceId: string, runId: string) {
		const row = await deps.runRow(runId);
		if (row.spaceId !== spaceId) throw new Refusal("not-found", RUN_NOT_FOUND);
		const project = await projects.get(row.projectId, spaceId);
		const shortId = shortIdOf(runId);
		const inspected = await branches.inspect(project.repoPath, [
			{ shortId, baseRef: row.baseRef },
		]);
		const state = inspected.runs.get(shortId) as RunCopyState;
		return { row, repoPath: project.repoPath, state };
	}

	async function record(
		row: Pick<RunRow, "id" | "projectId">,
		removed: { worktreePath: string | null; branches: string[] },
		by: "person" | "cleanup",
	): Promise<void> {
		await deps.log.append({
			type: "WorktreeRemoved",
			payload: { projectId: row.projectId, runId: row.id, ...removed, by },
		});
	}

	/** Removes the worktree (git forgets one whose folder is gone). Returns its path, or null when there was none. */
	async function removeCopy(
		repoPath: string,
		state: RunCopyState,
		force: boolean,
	): Promise<string | null> {
		if (state.exists) {
			await branches.removeWorktree(repoPath, state.worktreePath, { force });
			return state.worktreePath;
		}
		if (state.registered) {
			await branches.prune(repoPath);
			return state.worktreePath;
		}
		return null;
	}

	async function list(spaceId: string, projectId: string): Promise<RunCopies> {
		const project = await projects.get(projectId, spaceId);
		const runs = await deps.listRuns(spaceId, projectId);
		const inspected = await branches.inspect(
			project.repoPath,
			runs.map((run) => ({ shortId: shortIdOf(run.id), baseRef: run.baseRef })),
		);
		const removed = new Map<string, RunCopy["removed"]>();
		for (const e of await worktreeRemovals(deps.db, projectId)) {
			removed.set(e.payload.runId, { at: e.at, by: e.payload.by });
		}
		const { cleanUpRuns, cleanUpAfterDays } = deps.settings();
		const copies: RunCopy[] = [];
		for (const run of runs) {
			const state = inspected.runs.get(shortIdOf(run.id));
			if (!state) continue;
			const lastRemoval = removed.get(run.id) ?? null;
			if (!hasLeftovers(state) && !lastRemoval) continue;
			const active = isOpenStatus(run.status) || deps.isActive(run.id);
			const safe = isSafeToRemove(state);
			copies.push({
				runId: run.id,
				title: run.title,
				status: run.status,
				active,
				createdAt: run.createdAt,
				endedAt: run.endedAt,
				copy: state.exists,
				changes: state.changes,
				branches: state.branches,
				safe,
				cleanupAt:
					cleanUpRuns && safe && !active && hasLeftovers(state)
						? cleanupTime(run, cleanUpAfterDays)
						: null,
				removed: lastRemoval,
			});
		}
		return { defaultBranch: inspected.defaultBranch, copies };
	}

	/**
	 * A person removes the run's copy of the project. Its branches stay.
	 * Changes that are not committed are lost only with `force`.
	 */
	async function removeRunCopy(
		spaceId: string,
		runId: string,
		options: { force?: boolean } = {},
	): Promise<void> {
		const { row, repoPath, state } = await stateOf(spaceId, runId);
		await refuseOpen(runId);
		if (state.exists && !state.registered) {
			throw new Refusal(
				"conflict",
				"Git does not know this folder as a copy of the project, so Night Shift leaves it. Remove it yourself.",
			);
		}
		if (!state.exists && !state.registered) {
			throw new Refusal(
				"not-found",
				"This run has no copy of the project on this computer.",
			);
		}
		if (state.changes !== 0 && !options.force) {
			throw new Refusal(
				"conflict",
				"The run's copy has changes that are not committed. Confirm to remove them too.",
			);
		}
		const worktreePath = await removeCopy(repoPath, state, state.changes !== 0);
		await record(row, { worktreePath, branches: [] }, "person");
	}

	/**
	 * A person deletes the run's local branches. Never a branch on origin.
	 * Commits that are only on this computer are lost only with `force`.
	 */
	async function deleteRunBranches(
		spaceId: string,
		runId: string,
		options: { force?: boolean } = {},
	): Promise<void> {
		const { row, repoPath, state } = await stateOf(spaceId, runId);
		await refuseOpen(runId);
		if (state.exists && state.registered) {
			throw new Refusal(
				"conflict",
				"Remove the run's copy of the project first. Its branch is in use there.",
			);
		}
		if (state.branches.length === 0) {
			throw new Refusal(
				"not-found",
				"This run has no branches on this computer.",
			);
		}
		const unsaved = unsavedCommits(state);
		if (unsaved > 0 && !options.force) {
			throw new Refusal(
				"conflict",
				`${commits(unsaved)} of this run ${unsaved === 1 ? "is" : "are"} only on this computer. Confirm to delete ${unsaved === 1 ? "it" : "them"} too.`,
			);
		}
		const deleted: string[] = [];
		try {
			for (const branch of state.branches) {
				await branches.deleteBranch(repoPath, branch.name);
				deleted.push(branch.name);
			}
		} finally {
			if (deleted.length > 0) {
				await record(row, { worktreePath: null, branches: deleted }, "person");
			}
		}
	}

	/**
	 * The scheduled cleanup: in every project with a clone here, each run
	 * that ended `cleanUpAfterDays` ago loses its worktree and its local
	 * branches, when that loses nothing (`isSafeToRemove`). The rest stays
	 * for a person to choose. Idempotent: a run with nothing left is
	 * skipped. An error in one project or run is logged and skipped.
	 */
	async function sweep(): Promise<SweepResult> {
		const result: SweepResult = { removed: [], kept: 0 };
		const { cleanUpRuns, cleanUpAfterDays } = deps.settings();
		if (!cleanUpRuns) return result;
		const now = deps.now();
		for (const project of await projects.list()) {
			try {
				const due = (await deps.listRuns(project.spaceId, project.id)).filter(
					(run) =>
						!isOpenStatus(run.status) &&
						!deps.isActive(run.id) &&
						cleanupTime(run, cleanUpAfterDays) <= now,
				);
				if (due.length === 0) continue;
				const inspected = await branches.inspect(
					project.repoPath,
					due.map((run) => ({
						shortId: shortIdOf(run.id),
						baseRef: run.baseRef,
					})),
				);
				for (const run of due) {
					const state = inspected.runs.get(shortIdOf(run.id));
					if (!state || !hasLeftovers(state)) continue;
					if (!isSafeToRemove(state)) {
						result.kept++;
						continue;
					}
					let worktreePath: string | null = null;
					const deleted: string[] = [];
					try {
						await refuseOpen(run.id);
						// Without force: git itself refuses a worktree with changes.
						worktreePath = await removeCopy(project.repoPath, state, false);
						for (const branch of state.branches) {
							await branches.deleteBranch(project.repoPath, branch.name);
							deleted.push(branch.name);
						}
						result.removed.push(run.id);
					} catch (error) {
						result.kept++;
						console.warn(
							`[cleanup] kept the copy or branches of run ${run.id}:`,
							error instanceof Error ? error.message : error,
						);
					} finally {
						// What went, also when the rest stayed.
						if (worktreePath !== null || deleted.length > 0) {
							await record(
								{ id: run.id, projectId: project.id },
								{ worktreePath, branches: deleted },
								"cleanup",
							);
						}
					}
				}
			} catch (error) {
				console.warn(
					`[cleanup] skipped project ${project.id}:`,
					error instanceof Error ? error.message : error,
				);
			}
		}
		return result;
	}

	return { list, removeRunCopy, deleteRunBranches, sweep };
}

export type RunCopiesService = ReturnType<typeof createRunCopies>;
