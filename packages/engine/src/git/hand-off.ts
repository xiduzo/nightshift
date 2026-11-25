import { lstat, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Refusal } from "@nightshift/refusal";
import { DirtyWorktreeError } from "./dirty-worktree";
import { type Git, GitError, gitOrThrow } from "./git";
import { branchName, objectId } from "./git-names";
import { runMade } from "./run-made";
import {
	isRunsBranch,
	KEPT_REFS,
	keptRefsOf,
	shortIdOfBranch,
	worktreeLocation,
} from "./worktree-places";

/** The operations of `createWorktrees` that a Hand-off uses. */
export type HandOffParts = {
	resolveCommit(repoPath: string, ref?: string): Promise<string>;
	isAncestor(cwd: string, ancestor: string, commit: string): Promise<boolean>;
	branchExists(cwd: string, name: string): Promise<boolean>;
	currentBranch(cwd: string): Promise<string | null>;
	uncommittedChanges(cwd: string): Promise<string[]>;
	setWorktreeAuthor(
		repoPath: string,
		worktreePath: string,
		author: { name: string; email: string },
	): Promise<void>;
};

/** The changes that block a hand-off, for its message: up to five files. */
function changesShown(changes: readonly string[]): string {
	const shown = changes
		.slice(0, 5)
		.map((line) => line.slice(3))
		.join(", ");
	return changes.length > 5 ? `${shown} and ${changes.length - 5} more` : shown;
}

/** A branch of a clone on its way to `commit`, from where it was read (null: it is new). */
type BranchMove = {
	branch: string;
	commit: string;
	from: string | null;
	/** The note that goes with it, from what it was, when the run knows all that is on the branch. */
	note: { ref: string; from: string | null } | null;
};

/** The refusal of a Hand-off to a computer whose own branch of that name has other commits. */
export function branchHasOtherWork(branch: string): string {
	return `The branch "${branch}" on this device has commits that the run does not have. Rename that branch there, then try again.`;
}

/** The refusal of a Hand-off of work that the remote's branch does not have. */
export function notOnRemote(branch: string): string {
	return `The branch "${branch}" of the project's remote does not have the run's work. Try again.`;
}

/** The refusal of a Hand-off of a branch that a person has open. */
export function branchInUse(branch: string): string {
	return `The branch "${branch}" is open in another folder on this device. Switch that folder to another branch, then try again.`;
}

/**
 * The two halves of a Hand-off of a run's work between the clones of two
 * computers, over the git port and the other worktree operations
 * (`createWorktrees`).
 */
export function createHandOff(git: Git, parts: HandOffParts) {
	const {
		resolveCommit,
		isAncestor,
		branchExists,
		currentBranch,
		uncommittedChanges,
		setWorktreeAuthor,
	} = parts;

	/**
	 * The sending half of a Hand-off: refuses a worktree with changes that
	 * are not committed (decision 3: nothing is committed for you), then
	 * pushes the checked-out branch, and the run's own branch, to `origin`.
	 * The branches are the run's: a push replaces them.
	 */
	async function pushRunBranch(
		cwd: string,
		runBranch: string,
	): Promise<{ commit: string; branch: string }> {
		branchName(runBranch);
		const changes = await uncommittedChanges(cwd);
		if (changes.length > 0) {
			throw new DirtyWorktreeError(
				`The run's copy of the project has changes that are not committed (${changesShown(changes)}). Night Shift does not commit for you, so the work cannot move to the next device. Make the step before commit its work.`,
			);
		}
		const branch = (await currentBranch(cwd)) ?? runBranch;
		const commit = await gitOrThrow(git, cwd, ["rev-parse", "HEAD"]);
		const shortId = shortIdOfBranch(runBranch);
		// Before the push, which moves the remote's branch here too.
		const madeHere =
			shortId !== null &&
			!isRunsBranch(shortId, branch) &&
			(await madeInCopy(cwd, { shortId, branch, tip: commit }));
		const refspecs = [`+${commit}:refs/heads/${branch}`];
		// A computer that took the work on another branch may not have the run's own.
		if (branch !== runBranch && (await branchExists(cwd, runBranch))) {
			refspecs.push(`+refs/heads/${runBranch}:refs/heads/${runBranch}`);
		}
		await gitOrThrow(git, cwd, ["push", "-q", "origin", ...refspecs]);
		if (madeHere) {
			// The work is handed on. Without the note, a later rewrite is refused.
			const ref = keptRefsOf(shortId).handed(branch);
			await git.run(cwd, ["update-ref", ref, commit]);
		}
		return { commit, branch };
	}

	/** The commit a branch of the clone is at, or null without that branch. */
	async function branchTip(
		cwd: string,
		branch: string,
	): Promise<string | null> {
		const result = await git.run(cwd, [
			"rev-parse",
			"--verify",
			"--quiet",
			`refs/heads/${branch}`,
		]);
		return result.exitCode === 0 ? result.stdout : null;
	}

	/** The tip of a branch that the run handed on or took here, when all that was on it was the run's own. */
	async function handedTip(
		cwd: string,
		shortId: string,
		branch: string,
	): Promise<string | null> {
		const ref = keptRefsOf(shortId).handed(branch);
		const result = await git.run(cwd, [
			"rev-parse",
			"--verify",
			"--quiet",
			ref,
		]);
		return result.exitCode === 0 ? result.stdout : null;
	}

	/** A file git keeps, or nothing. */
	async function gitFile(cwd: string, path: string): Promise<string> {
		const found = await git.run(cwd, ["rev-parse", "--git-path", path]);
		if (found.exitCode !== 0) return "";
		return readFile(resolve(cwd, found.stdout), "utf8").catch(() => "");
	}

	/** Whether the copy at `cwd` made all that is on `branch` at `tip` (`runMade`). */
	async function madeInCopy(
		cwd: string,
		run: { shortId: string; branch: string; tip: string },
	): Promise<boolean> {
		const handed = await handedTip(cwd, run.shortId, run.branch);
		const [branch, head, only] = await Promise.all([
			gitFile(cwd, `logs/refs/heads/${run.branch}`),
			gitFile(cwd, "logs/HEAD"),
			onlyOn(cwd, run, handed),
		]);
		return runMade({ branch, head }, { ...run, handed, only });
	}

	/**
	 * The commits of `branch` that nothing else has: no tag, and no branch but
	 * the ones that runs move (their own names, and the ones they handed on).
	 * What the run's own branch has is the run's, also from another computer.
	 */
	async function onlyOn(
		cwd: string,
		{ shortId, branch, tip }: { shortId: string; branch: string; tip: string },
		handed: string | null,
	): Promise<string[]> {
		const list = async (...args: string[]) =>
			(await gitOrThrow(git, cwd, args)).split("\n").filter(Boolean);
		const noted = new Set(
			(await list("for-each-ref", "--format=%(refname)", KEPT_REFS)).map(
				(ref) => ref.slice(ref.lastIndexOf("/") + 1),
			),
		);
		const names = await list(
			"for-each-ref",
			"--format=%(refname:lstrip=2)",
			"refs/heads",
		);
		const own = worktreeLocation("", shortId).branch;
		const handedRef = keptRefsOf("").handed;
		const moved = [
			branch,
			`${worktreeLocation("", "").branch}*`,
			...names.filter((name) =>
				noted.has(handedRef(name).slice(handedRef(name).lastIndexOf("/") + 1)),
			),
		];
		return list(
			"rev-list",
			"--ignore-missing",
			tip,
			"--not",
			...moved.map((name) => `--exclude=${name}`),
			"--branches",
			...moved.map((name) => `--exclude=origin/${name}`),
			"--remotes",
			"--tags",
			`refs/heads/${own}`,
			`refs/remotes/origin/${own}`,
			...(handed === null ? [] : [handed]),
		);
	}

	/**
	 * The move of a branch to `commit`. Refuses one that would leave commits
	 * of it behind. With a note when the run knows all that is on it: the
	 * branch is new here, or is as the run last handed it on.
	 */
	async function moveOf(
		repoPath: string,
		shortId: string,
		branch: string,
		commit: string,
	): Promise<BranchMove> {
		const from = await branchTip(repoPath, branch);
		const move = { branch, commit, from, note: null };
		if (isRunsBranch(shortId, branch)) return move;
		const handed = await handedTip(repoPath, shortId, branch);
		if (from === null || from === handed) {
			const ref = keptRefsOf(shortId).handed(branch);
			return { ...move, note: { ref, from: handed } };
		}
		if (await isAncestor(repoPath, from, commit)) return move;
		throw new Refusal("conflict", branchHasOtherWork(branch));
	}

	/** Refuses a branch that a folder other than the run's worktree has checked out. */
	async function refuseCheckedOut(
		repoPath: string,
		worktreePath: string,
		branch: string,
	): Promise<void> {
		const own = await realpath(worktreePath).catch(() => worktreePath);
		let path = "";
		for (const line of (
			await gitOrThrow(git, repoPath, ["worktree", "list", "--porcelain"])
		).split("\n")) {
			if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
			else if (
				line === `branch refs/heads/${branch}` &&
				path !== own &&
				path !== worktreePath
			) {
				throw new Refusal("conflict", branchInUse(branch));
			}
		}
	}

	/** Changes refs in one step, each only when it is still where it was read (null: it is not there). */
	async function changeRefs(
		cwd: string,
		changes: readonly {
			ref: string;
			from: string | null;
			to: string | null;
		}[],
	): Promise<void> {
		const args = ["update-ref", "--stdin"];
		const none = (id: string) => "0".repeat(id.length);
		const input = changes
			.map(({ ref, from, to }) => {
				const any = to ?? from ?? "";
				return `update ${ref} ${to ?? none(any)} ${from ?? none(any)}\n`;
			})
			.join("");
		const result = await git.run(cwd, args, { input });
		if (result.exitCode !== 0) {
			throw new GitError(args, result.exitCode, result.stderr);
		}
	}

	/** Moves the branch, with its note. */
	function moveBranch(
		cwd: string,
		{ branch, commit, from, note }: BranchMove,
	): Promise<void> {
		return changeRefs(cwd, [
			{ ref: `refs/heads/${branch}`, from, to: commit },
			...(note ? [{ ref: note.ref, from: note.from, to: commit }] : []),
		]);
	}

	/** Moves the branch back, with its note, when nothing else moved them since. */
	async function moveBack(
		cwd: string,
		{ branch, commit, from, note }: BranchMove,
	): Promise<void> {
		await changeRefs(cwd, [
			{ ref: `refs/heads/${branch}`, from: commit, to: from },
			...(note ? [{ ref: note.ref, from: commit, to: note.from }] : []),
		]).catch((error) => {
			console.warn(`[projects] ${branch} was not put back: ${error}`);
		});
	}

	/** Puts the run's worktree on the branch at its new commit. */
	async function takeInCopy(
		worktreePath: string,
		move: BranchMove,
	): Promise<void> {
		const before =
			(await currentBranch(worktreePath)) ??
			(await resolveCommit(worktreePath));
		let moved = false;
		try {
			// Off the branch while it moves: its files stay those of a commit.
			await gitOrThrow(git, worktreePath, [
				"checkout",
				"-q",
				"--detach",
				move.commit,
			]);
			await moveBranch(worktreePath, move);
			moved = true;
			await gitOrThrow(git, worktreePath, [
				"checkout",
				"-q",
				move.branch,
				"--",
			]);
		} catch (error) {
			if (moved) await moveBack(worktreePath, move);
			await git.run(worktreePath, ["checkout", "-q", before, "--"]);
			throw error;
		}
	}

	/** Adds the run's worktree on the branch at its new commit. */
	async function takeInNewCopy(
		repoPath: string,
		worktreePath: string,
		move: BranchMove,
	): Promise<void> {
		await mkdir(dirname(worktreePath), { recursive: true });
		let moved = false;
		try {
			await gitOrThrow(git, repoPath, [
				"worktree",
				"add",
				"-q",
				"--detach",
				worktreePath,
				move.commit,
			]);
			await moveBranch(worktreePath, move);
			moved = true;
			await gitOrThrow(git, worktreePath, [
				"checkout",
				"-q",
				move.branch,
				"--",
			]);
		} catch (error) {
			if (moved) await moveBack(repoPath, move);
			// Git makes the folder before a hook of the project fails.
			if (await lstat(worktreePath).catch(() => null)) {
				const args = ["worktree", "remove", "--force", worktreePath];
				await git.run(repoPath, args);
			}
			throw error;
		}
	}

	/**
	 * The receiving half of a Hand-off: fetches `branch` from `origin` into
	 * the clone, then checks it out at `commit` in the run's worktree (added
	 * when this clone has none). A worktree it has must be clean. A branch of
	 * the clone that is not one of the run's names moves only when none of its
	 * commits stays behind, or when it is as the run last handed it on.
	 * Refused, or failed: the branch and the worktree are as they were.
	 */
	async function pullRunBranch(input: {
		repoPath: string;
		shortId: string;
		branch: string;
		commit: string;
		author?: { name: string; email: string };
	}): Promise<{ worktreePath: string; branch: string; baseRef: string }> {
		const { repoPath } = input;
		const branch = branchName(input.branch);
		const commit = objectId(input.commit);
		await gitOrThrow(git, repoPath, [
			"fetch",
			"-q",
			"origin",
			`+refs/heads/${branch}:refs/remotes/origin/${branch}`,
		]);
		const { worktreePath } = worktreeLocation(repoPath, input.shortId);
		await resolveCommit(repoPath, commit);
		const remote = `refs/remotes/origin/${branch}`;
		if (!(await isAncestor(repoPath, commit, remote))) {
			throw new Refusal("conflict", notOnRemote(branch));
		}
		const move = await moveOf(repoPath, input.shortId, branch, commit);
		await refuseCheckedOut(repoPath, worktreePath, branch);
		const exists = await stat(worktreePath).catch(() => null);
		if (exists?.isDirectory()) {
			const changes = await uncommittedChanges(worktreePath);
			if (changes.length > 0) {
				throw new DirtyWorktreeError(
					`The run's copy of the project on this device has changes that are not committed (${changesShown(changes)}). Commit or discard them there first.`,
				);
			}
			await takeInCopy(worktreePath, move);
		} else {
			await takeInNewCopy(repoPath, worktreePath, move);
			if (input.author)
				await setWorktreeAuthor(input.repoPath, worktreePath, input.author);
		}
		return { worktreePath, branch, baseRef: commit };
	}

	return { pushRunBranch, pullRunBranch };
}
