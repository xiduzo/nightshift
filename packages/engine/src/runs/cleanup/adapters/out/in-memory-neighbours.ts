import { Refusal } from "@nightshift/refusal";
import { asDate } from "@nightshift/time";
import { inMemoryAccess } from "../../../../access/adapters/out/in-memory-access";
import type { RunStatus } from "../../../../run-status";
import type {
	CleanupGround,
	CleanupProjects,
	CleanupRuns,
	RunBranches,
	RunFolderFiles,
} from "../../application/ports";
import type { RunFile } from "../../domain/run-files";
import type { RunCopyState } from "../../domain/safety";

/**
 * The in-memory adapters of the ports that another vertical fills
 * (`@filledBy` in `application/ports.ts`), and `inMemoryCleanupPorts`,
 * the ports of the slice that are no database. Test code:
 * production code never imports this file.
 */

const DAY_MS = 24 * 60 * 60_000;

/** A run as the twin keeps it. */
export type TwinRun = {
	id: string;
	spaceId: string;
	projectId: string;
	status: RunStatus;
	createdAt: number;
	endedAt: number | null;
	baseRef: string;
	runFolder: boolean;
	/** This version cannot read its flow. */
	flowUnread: boolean;
};

/** The runs of this computer, and which have a step at work here. */
export function inMemoryCleanupRuns() {
	const twin = {
		runs: new Map<string, TwinRun>(),
		active: new Set<string>(),
		/** Every read, in order: `row run-1`, `state run-1`. */
		reads: [] as string[],
		/** Adds a run that ended at `endedAt` (open while it is null and its status is open). */
		add(run: Partial<TwinRun> & { id: string }) {
			twin.runs.set(run.id, {
				spaceId: "space-1",
				projectId: "project-1",
				status: "finished",
				createdAt: 0,
				endedAt: DAY_MS,
				baseRef: "base",
				runFolder: false,
				flowUnread: false,
				...run,
			});
		},
		async listRuns(spaceId: string, projectId: string) {
			return [...twin.runs.values()]
				.filter((run) => run.spaceId === spaceId && run.projectId === projectId)
				.reverse();
		},
		async runStatus(runId: string) {
			return twin.runs.get(runId)?.status ?? null;
		},
		async runRow(runId: string) {
			twin.reads.push(`row ${runId}`);
			const run = twin.runs.get(runId);
			if (!run)
				throw new Refusal("not-found", "Night Shift cannot find this run.");
			return { projectId: run.projectId, createdAt: asDate(run.createdAt) };
		},
		async runState(runId: string) {
			twin.reads.push(`state ${runId}`);
			const run = twin.runs.get(runId);
			return {
				status: run?.status ?? ("running" as RunStatus),
				end: run?.endedAt != null ? { at: run.endedAt } : null,
				runFolder: run?.runFolder ?? false,
			};
		},
		async flowUnread(runId: string) {
			return twin.runs.get(runId)?.flowUnread ?? false;
		},
		isActive(runId: string) {
			return twin.active.has(runId);
		},
	};
	return twin satisfies CleanupRuns;
}

/** The projects with a Clone here. */
export function inMemoryCleanupProjects() {
	const twin = {
		projects: [] as { id: string; spaceId: string; repoPath: string }[],
		async list() {
			return twin.projects;
		},
	};
	return twin satisfies CleanupProjects;
}

/** The clock and the switch, as the test sets them. */
export function inMemoryCleanupGround() {
	const twin = {
		at: 10 * DAY_MS,
		cleanUpRuns: true,
		cleanUpAfterDays: 7,
		now: () => twin.at,
		settings: () => ({
			cleanUpRuns: twin.cleanUpRuns,
			cleanUpAfterDays: twin.cleanUpAfterDays,
		}),
	};
	return twin satisfies CleanupGround;
}

const KEPT = "refs/nightshift/kept/";

/**
 * The run copies and branches of the clones, in memory: the test sets
 * what each run left (`leave`). Each change is recorded in `done`, in
 * order. `failOn` makes the next call of that name throw.
 */
export function inMemoryRunBranches() {
	const left = new Map<string, RunCopyState>();
	const keyOf = (repoPath: string, shortId: string) => `${repoPath}#${shortId}`;
	let commits = 0;
	const twin = {
		/** What was done, in order: `keep <ref> <commit>`, `remove <path> force`. */
		done: [] as string[],
		/** Kept refs by repository, with their commit. */
		kept: new Map<string, Map<string, string>>(),
		failing: new Set<string>(),
		failOn(call: string) {
			twin.failing.add(call);
		},
		/** What the run of `shortId` left in the clone at `repoPath`. */
		leave(
			repoPath: string,
			shortId: string,
			state: Partial<RunCopyState> = {},
		) {
			left.set(keyOf(repoPath, shortId), {
				worktreePath: `${repoPath}.nightshift/${shortId}`,
				exists: true,
				registered: true,
				changes: 0,
				head: null,
				branches: [],
				...state,
			});
		},
		fail(call: string) {
			if (twin.failing.delete(call)) throw new Error(`${call} failed`);
		},
		async inspect(
			repoPath: string,
			runs: readonly { shortId: string; baseRef: string }[],
		) {
			const states = new Map<string, RunCopyState>();
			for (const { shortId } of runs) {
				states.set(
					shortId,
					left.get(keyOf(repoPath, shortId)) ?? {
						worktreePath: `${repoPath}.nightshift/${shortId}`,
						exists: false,
						registered: false,
						changes: 0,
						head: null,
						branches: [],
					},
				);
			}
			return states;
		},
		async listKept(repoPath: string) {
			const byShortId = new Map<string, { ref: string; commit: string }[]>();
			for (const [ref, commit] of twin.kept.get(repoPath) ?? []) {
				const shortId = ref.slice(KEPT.length).split("/")[0] ?? "";
				byShortId.set(shortId, [
					...(byShortId.get(shortId) ?? []),
					{ ref, commit },
				]);
			}
			return byShortId;
		},
		async commitChanges(cwd: string, _message: string) {
			twin.fail("commitChanges");
			commits++;
			twin.done.push(`commit ${cwd}`);
			return `kept-${commits}`;
		},
		async keep(repoPath: string, ref: string, commit: string) {
			twin.fail("keep");
			const refs = twin.kept.get(repoPath) ?? new Map<string, string>();
			refs.set(ref, commit);
			twin.kept.set(repoPath, refs);
			twin.done.push(`keep ${ref} ${commit}`);
		},
		async deleteRef(repoPath: string, ref: string) {
			twin.fail("deleteRef");
			twin.kept.get(repoPath)?.delete(ref);
			twin.done.push(`delete-ref ${ref}`);
		},
		async removeWorktree(
			_repoPath: string,
			worktreePath: string,
			options: { force?: boolean } = {},
		) {
			twin.fail("removeWorktree");
			twin.done.push(`remove ${worktreePath}${options.force ? " force" : ""}`);
		},
		async deleteBranch(_repoPath: string, name: string) {
			twin.fail("deleteBranch");
			twin.done.push(`delete-branch ${name}`);
		},
		async prune(repoPath: string) {
			twin.done.push(`prune ${repoPath}`);
		},
		keptRefs(shortId: string) {
			const prefix = `${KEPT}${shortId}/`;
			return {
				copy: `${prefix}copy`,
				branch: (name: string) => `${prefix}heads/${name}`,
			};
		},
	};
	return twin satisfies RunBranches;
}

/** The run folders of this computer, in memory: the test adds a folder with its files (`add`). */
export function inMemoryRunFolderFiles() {
	const twin = {
		folders: new Map<string, { files: RunFile[]; changedAt: number }>(),
		removed: [] as string[],
		add(runId: string, files: RunFile[] = [], changedAt = 0) {
			twin.folders.set(runId, { files, changedAt });
		},
		path: (runId: string) => `/data/run-folders/${runId}`,
		async runIds() {
			return [...twin.folders.keys()];
		},
		async list(runId: string) {
			const folder = twin.folders.get(runId);
			return folder ? { files: folder.files, more: false } : null;
		},
		async file(runId: string, path: string) {
			const file = twin.folders.get(runId)?.files.find((f) => f.path === path);
			return file ? { file, path: `${twin.path(runId)}/${path}` } : null;
		},
		async lastChange(runId: string) {
			return twin.folders.get(runId)?.changedAt ?? null;
		},
		async remove(runId: string) {
			twin.folders.delete(runId);
			twin.removed.push(runId);
		},
	};
	return twin satisfies RunFolderFiles;
}

/** The ports of cleanup that are no database, in memory. */
export function inMemoryCleanupPorts() {
	return {
		access: inMemoryAccess(),
		runs: inMemoryCleanupRuns(),
		projects: inMemoryCleanupProjects(),
		ground: inMemoryCleanupGround(),
		branches: inMemoryRunBranches(),
		folders: inMemoryRunFolderFiles(),
	};
}
