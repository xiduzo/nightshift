import type { RunLog } from "../log";
import {
	keptRefsOf,
	type Projects,
	type RunBranches,
	type RunCopyState,
} from "../projects";
import { isOpenStatus, type RunSummary } from "../read";
import type { RunStatus } from "../run-status";
import {
	cleanupTime,
	hasLeftovers,
	RUN_COPY_DAYS,
	whyLeave,
	workToKeep,
} from "./safety";

/**
 * The scheduled cleanup of what runs left in the clones of projects on
 * this computer. A day after a run ended (`RUN_COPY_DAYS`), its worktree
 * and its local branches go. Work that is only here goes out of sight
 * first: changes that are not committed become one commit, and the copy
 * and each branch with commits only here get a kept ref
 * (`refs/nightshift/kept/<short>/…`, `keptRefsOf`), which `git branch`
 * does not list. The kept refs go `cleanUpAfterDays` after the run ended.
 * A resume or a rerun makes the copy again from them
 * (`restoreWorktree`).
 *
 * A run that is still open (running, waiting at a Gate, asleep) is never
 * touched, nor is a branch another worktree has checked out, nor a
 * worktree git does not know. Every removal is logged as
 * `WorktreeRemoved`. Remote branches are never touched. The switch
 * `cleanUpRuns` turns all of it off.
 */

/** What a sweep did: the runs whose copy and branches went, those whose kept work went, and how many it left. */
export type SweepResult = {
	removed: string[];
	expired: string[];
	left: number;
};

export type RunCopiesDeps = {
	/** Appends `WorktreeRemoved`. */
	log: Pick<RunLog, "append">;
	branches: RunBranches;
	projects: Pick<Projects, "list">;
	/** The project's runs in the Space, newest first. */
	listRuns(spaceId: string, projectId: string): Promise<RunSummary[]>;
	runStatus(runId: string): Promise<RunStatus | null>;
	/** A step of the run is at work in this process. */
	isActive(runId: string): boolean;
	now(): number;
	settings(): { cleanUpRuns: boolean; cleanUpAfterDays: number };
};

const shortIdOf = (runId: string) => runId.slice(0, 8);

/** What one removal took away, as `WorktreeRemoved` says it. */
type Removed = {
	worktreePath: string | null;
	branches: string[];
	kept?: string[];
	expired?: string[];
};

export function createRunCopies(deps: RunCopiesDeps) {
	const { branches } = deps;

	/** The run goes on (or started again): nothing removes its work. */
	async function isOpen(runId: string): Promise<boolean> {
		const status = await deps.runStatus(runId);
		return deps.isActive(runId) || (status !== null && isOpenStatus(status));
	}

	async function record(
		projectId: string,
		runId: string,
		removed: Removed,
	): Promise<void> {
		await deps.log.append({
			type: "WorktreeRemoved",
			payload: { projectId, runId, ...removed, by: "cleanup" },
		});
	}

	/** Removes the worktree (git forgets one whose folder is gone). Returns its path, or null when there was none. */
	async function removeCopy(
		repoPath: string,
		state: RunCopyState,
	): Promise<string | null> {
		if (state.exists) {
			// Its changes are kept by now. Without them, git checks it is clean.
			await branches.removeWorktree(repoPath, state.worktreePath, {
				force: (state.changes ?? 0) > 0,
			});
			return state.worktreePath;
		}
		if (state.registered) {
			await branches.prune(repoPath);
			return state.worktreePath;
		}
		return null;
	}

	/**
	 * Keeps the run's work that is only here, then removes its copy and
	 * deletes its local branches. False when the run started again.
	 */
	async function removeRun(
		repoPath: string,
		projectId: string,
		runId: string,
		state: RunCopyState,
	): Promise<boolean> {
		const shortId = shortIdOf(runId);
		const refs = keptRefsOf(shortId);
		const keep = workToKeep(state);
		const kept: string[] = [];
		const deleted: string[] = [];
		let worktreePath: string | null = null;
		try {
			if (await isOpen(runId)) return false;
			if (keep.copy && state.head) {
				const commit =
					(state.changes ?? 0) > 0
						? await branches.commitChanges(
								state.worktreePath,
								`Night Shift kept the changes run ${shortId} did not commit`,
							)
						: state.head.commit;
				await branches.keep(repoPath, refs.copy, commit);
				kept.push(refs.copy);
			}
			for (const branch of keep.branches) {
				await branches.keep(repoPath, refs.branch(branch.name), branch.commit);
				kept.push(refs.branch(branch.name));
			}
			worktreePath = await removeCopy(repoPath, state);
			for (const branch of state.branches) {
				await branches.deleteBranch(repoPath, branch.name);
				deleted.push(branch.name);
			}
			return true;
		} finally {
			// What went, also when the rest stayed after an error.
			if (worktreePath !== null || deleted.length > 0 || kept.length > 0) {
				await record(projectId, runId, {
					worktreePath,
					branches: deleted,
					...(kept.length > 0 ? { kept } : {}),
				});
			}
		}
	}

	/**
	 * Deletes the kept refs of each run that ended `afterDays` ago. Kept
	 * work of a run this computer does not know stays: nothing tells when
	 * that run ended.
	 */
	async function expire(
		project: { id: string; repoPath: string },
		runs: readonly RunSummary[],
		afterDays: number,
		result: SweepResult,
	): Promise<void> {
		const kept = await branches.listKept(project.repoPath);
		if (kept.size === 0) return;
		const byShortId = new Map(runs.map((run) => [shortIdOf(run.id), run]));
		const now = deps.now();
		for (const [shortId, refs] of kept) {
			const run = byShortId.get(shortId);
			if (!run || cleanupTime(run, afterDays) > now) continue;
			if (await isOpen(run.id)) continue;
			const expired: string[] = [];
			try {
				for (const ref of refs) {
					await branches.deleteRef(project.repoPath, ref);
					expired.push(ref);
				}
				result.expired.push(run.id);
			} catch (error) {
				console.warn(
					`[cleanup] kept the work of run ${run.id}:`,
					error instanceof Error ? error.message : error,
				);
			} finally {
				if (expired.length > 0) {
					await record(project.id, run.id, {
						worktreePath: null,
						branches: [],
						expired,
					});
				}
			}
		}
	}

	/**
	 * One round of the cleanup: in every project with a clone here, the
	 * copy and branches of each run that ended a day ago, then the kept
	 * work of each run that ended `cleanUpAfterDays` ago. Idempotent: a run
	 * with nothing left is skipped. An error in one project or run is
	 * logged and skipped.
	 */
	async function sweep(): Promise<SweepResult> {
		const result: SweepResult = { removed: [], expired: [], left: 0 };
		const { cleanUpRuns, cleanUpAfterDays } = deps.settings();
		if (!cleanUpRuns) return result;
		for (const project of await deps.projects.list()) {
			try {
				const runs = await deps.listRuns(project.spaceId, project.id);
				const now = deps.now();
				const due = runs.filter(
					(run) =>
						!isOpenStatus(run.status) &&
						!deps.isActive(run.id) &&
						cleanupTime(run, RUN_COPY_DAYS) <= now,
				);
				const states =
					due.length > 0
						? await branches.inspect(
								project.repoPath,
								due.map((run) => ({
									shortId: shortIdOf(run.id),
									baseRef: run.baseRef,
								})),
							)
						: new Map<string, RunCopyState>();
				for (const run of due) {
					const state = states.get(shortIdOf(run.id));
					if (!state || !hasLeftovers(state)) continue;
					if (whyLeave(state) !== null) {
						result.left++;
						continue;
					}
					try {
						if (await removeRun(project.repoPath, project.id, run.id, state)) {
							result.removed.push(run.id);
						} else {
							result.left++;
						}
					} catch (error) {
						result.left++;
						console.warn(
							`[cleanup] left the copy or branches of run ${run.id}:`,
							error instanceof Error ? error.message : error,
						);
					}
				}
				await expire(project, runs, cleanUpAfterDays, result);
			} catch (error) {
				console.warn(
					`[cleanup] skipped project ${project.id}:`,
					error instanceof Error ? error.message : error,
				);
			}
		}
		return result;
	}

	return { sweep };
}
