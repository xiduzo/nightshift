import { KEPT_WORK_DAYS, keptWorkFate } from "../domain/kept-work";
import { keepsWork } from "../domain/run-files";
import {
	cleanupTime,
	hasLeftovers,
	RUN_COPY_DAYS,
	type RunCopyState,
	type WorktreeRemoved,
	whyLeave,
	workToKeep,
} from "../domain/safety";
import type {
	CleanupGround,
	CleanupProjects,
	CleanupRuns,
	RemovalLog,
	RunBranches,
} from "./ports";

export type SweepRunCopiesPorts = {
	branches: RunBranches;
	projects: CleanupProjects;
	runs: Pick<CleanupRuns, "listRuns" | "runStatus" | "flowUnread" | "isActive">;
	ground: CleanupGround;
	removalLog: RemovalLog;
};

/** What a sweep did: the runs whose copy and branches went, those whose kept work went, and how many it left. */
export type SweepResult = {
	removed: string[];
	expired: string[];
	left: number;
};

/** A run of a project as the sweep reads it. */
type EndedRun = Awaited<ReturnType<CleanupRuns["listRuns"]>>[number];

/** What one removal took away, as `WorktreeRemoved` says it. */
type Removed = Pick<
	WorktreeRemoved,
	"worktreePath" | "branches" | "kept" | "expired"
>;

const shortIdOf = (runId: string) => runId.slice(0, 8);

/**
 * The scheduled cleanup of what runs left in the clones of projects on
 * this computer. A day after a run ended (`RUN_COPY_DAYS`), its worktree
 * and its local branches go. Work that is only here goes out of sight
 * first: changes that are not committed become one commit, and the copy
 * and each branch with commits only here get a kept ref
 * (`refs/nightshift/kept/<short>/…`), which `git branch` does not list.
 * The kept refs go `KEPT_WORK_DAYS` after the run ended (`keptWorkFate`).
 * Until then, a resume or a rerun makes the copy again from them
 * (`restoreWorktree`). After, a copy that would start from the run's base
 * is refused (`keptWorkGone`).
 *
 * A run that is still open (running, waiting at a Gate, asleep) is never
 * touched, nor is one Night Shift cut short whose flow this version cannot
 * read (`keepsWork`), nor is a branch another worktree has checked out, nor a
 * worktree git does not know. Every removal is logged as
 * `WorktreeRemoved`. Remote branches are never touched. The switch
 * `cleanUpRuns` turns all of it off.
 *
 * One round: in every project with a clone here, the copy and branches of
 * each run that ended a day ago, then the kept work of each run that ended
 * `KEPT_WORK_DAYS` ago. One line logs how many runs' kept work went, when any did.
 * Idempotent: a run with nothing left is skipped. An error in one project
 * or run is logged and skipped.
 */
export const sweepRunCopies =
	(ports: SweepRunCopiesPorts) => async (): Promise<SweepResult> => {
		const { branches, runs, ground } = ports;

		/** The run goes on (or started again), or only another version can continue it: nothing removes its work. */
		async function keeps(runId: string): Promise<boolean> {
			const status = await runs.runStatus(runId);
			return (
				runs.isActive(runId) ||
				(status !== null && (await keepsWork(runId, status, runs)))
			);
		}

		async function record(
			projectId: string,
			runId: string,
			removed: Removed,
		): Promise<void> {
			await ports.removalLog.removed({
				projectId,
				runId,
				...removed,
				by: "cleanup",
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
			const refs = branches.keptRefs(shortId);
			const keep = workToKeep(state);
			const kept: string[] = [];
			const deleted: string[] = [];
			let worktreePath: string | null = null;
			try {
				if (await keeps(runId)) return false;
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
					await branches.keep(
						repoPath,
						refs.branch(branch.name),
						branch.commit,
					);
					kept.push(refs.branch(branch.name));
				}
				if (kept.length > 0) keptNow.add(shortId);
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
		 * Deletes the kept refs of each run whose kept work is due
		 * (`keptWorkFate`): by the run's end and by when the cleanup last kept
		 * its work (in the log, or in this sweep), or for a run this computer
		 * does not know, by that keep alone.
		 */
		async function expire(
			project: { id: string; repoPath: string },
			projectRuns: readonly EndedRun[],
			result: SweepResult,
		): Promise<void> {
			const kept = await branches.listKept(project.repoPath);
			if (kept.size === 0) return;
			const byShortId = new Map(
				projectRuns.map((run) => [shortIdOf(run.id), run]),
			);
			const now = ground.now();
			const keptAt = new Map<string, { runId: string; at: number }>();
			for (const removal of await ports.removalLog.removals(project.id)) {
				if (removal.kept) {
					keptAt.set(shortIdOf(removal.runId), {
						runId: removal.runId,
						at: removal.at,
					});
				}
			}
			for (const [shortId, refs] of kept) {
				const run = byShortId.get(shortId);
				const runId = run?.id ?? keptAt.get(shortId)?.runId;
				if (runId === undefined) continue;
				const facts = {
					endedAt: run ? (run.endedAt ?? run.createdAt) : null,
					keptAt: keptNow.has(shortId)
						? now
						: (keptAt.get(shortId)?.at ?? null),
					now,
				};
				// Only a due run is asked whether it goes on.
				if (keptWorkFate({ ...facts, open: false }) === "keep") continue;
				const open = run ? await keeps(runId) : runs.isActive(runId);
				if (keptWorkFate({ ...facts, open }) === "keep") continue;
				const expired: string[] = [];
				try {
					for (const ref of refs) {
						await branches.deleteRef(project.repoPath, ref);
						expired.push(ref);
					}
					result.expired.push(runId);
				} catch (error) {
					console.warn(
						`[cleanup] kept the work of run ${runId}:`,
						error instanceof Error ? error.message : error,
					);
				} finally {
					if (expired.length > 0) {
						await record(project.id, runId, {
							worktreePath: null,
							branches: [],
							expired,
						});
					}
				}
			}
		}

		const result: SweepResult = { removed: [], expired: [], left: 0 };
		/** The runs whose work this sweep kept, by short id: it stays at least `KEPT_WORK_DAYS` from now. */
		const keptNow = new Set<string>();
		if (!ground.settings().cleanUpRuns) return result;
		for (const project of await ports.projects.list()) {
			try {
				const projectRuns = await runs.listRuns(project.spaceId, project.id);
				const now = ground.now();
				const due: EndedRun[] = [];
				for (const run of projectRuns) {
					if (cleanupTime(run, RUN_COPY_DAYS) > now) continue;
					if (runs.isActive(run.id)) continue;
					if (!(await keepsWork(run.id, run.status, runs))) due.push(run);
				}
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
				await expire(project, projectRuns, result);
			} catch (error) {
				console.warn(
					`[cleanup] skipped project ${project.id}:`,
					error instanceof Error ? error.message : error,
				);
			}
		}
		const freed = result.expired.length;
		if (freed > 0) {
			console.log(
				`[cleanup] freed the kept work of ${freed} run${freed === 1 ? "" : "s"} (${KEPT_WORK_DAYS} days after each ended)`,
			);
		}
		return result;
	};
