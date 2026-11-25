import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Refusal } from "@nightshift/refusal";
import { DirtyWorktreeError } from "./dirty-worktree";
import { type Git, gitOrThrow } from "./git";
import { branchName, objectId } from "./git-names";
import {
	isRunsBranch,
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
type BranchMove = { branch: string; commit: string; from: string | null };

/** What git writes in the log of HEAD for a commit it made there. */
const MADE_HERE =
	/^(commit( \([a-z]+\))?:|rebase( -i)? \((pick|reword|edit|squash|fixup|continue)\)|cherry-pick:|revert:|merge .*: Merge made)/;

/** The refusal of a Hand-off to a computer whose own branch of that name has other commits. */
export function branchHasOtherWork(branch: string): string {
	return `The branch "${branch}" on this device has commits that the run does not have. Rename that branch there, then try again.`;
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
			(await madeInCopy(cwd, shortId, branch));
		const refspecs = [`+${commit}:refs/heads/${branch}`];
		// A computer that took the work on another branch may not have the run's own.
		if (branch !== runBranch && (await branchExists(cwd, runBranch))) {
			refspecs.push(`+refs/heads/${runBranch}:refs/heads/${runBranch}`);
		}
		await gitOrThrow(git, cwd, ["push", "-q", "origin", ...refspecs]);
		if (madeHere) await noteHanded(cwd, shortId, branch, commit);
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

	/** Notes that tip. */
	async function noteHanded(
		cwd: string,
		shortId: string,
		branch: string,
		commit: string,
	): Promise<void> {
		const ref = keptRefsOf(shortId).handed(branch);
		const noted = await git.run(cwd, ["update-ref", ref, commit]);
		if (noted.exitCode !== 0) {
			// The work is handed on. A branch the run rewrites later is refused.
			console.warn(
				`[projects] noting the hand-off of ${branch} failed: ${noted.stderr}`,
			);
		}
	}

	/** What the log of a ref says, newest first: each commit it was at, when, and why. */
	async function refLog(
		cwd: string,
		ref: string,
	): Promise<{ commit: string; at: string; why: string }[]> {
		const log = await git.run(cwd, [
			"log",
			"-g",
			"--date=unix",
			"--format=%H%x09%gd%x09%gs",
			ref,
			"--",
		]);
		if (log.exitCode !== 0) return [];
		return log.stdout
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const [commit = "", name = "", ...why] = line.split("\t");
				const at = name.slice(name.lastIndexOf("@{"));
				return { commit, at, why: why.join("\t") };
			});
	}

	/**
	 * Whether all that is on `branch` is the run's own: the run made the
	 * branch in its copy at `cwd`, or handed it on before, and only commits
	 * made in that copy came to it since. Git's logs of the branch and of the
	 * copy's HEAD say so. Without them it is not known.
	 */
	async function madeInCopy(
		cwd: string,
		shortId: string,
		branch: string,
	): Promise<boolean> {
		const handed = await handedTip(cwd, shortId, branch);
		const [entries, head] = await Promise.all([
			refLog(cwd, `refs/heads/${branch}`),
			refLog(cwd, "HEAD"),
		]);
		const made = new Set(
			head.filter((e) => MADE_HERE.test(e.why)).map((e) => e.commit),
		);
		for (const entry of entries) {
			if (entry.commit === handed) return true;
			if (!made.has(entry.commit)) {
				// Its first commit: the branch was made with a checkout in the copy.
				return (
					entry === entries.at(-1) &&
					head.some(
						(e) =>
							e.at === entry.at &&
							e.why.startsWith("checkout: ") &&
							e.why.endsWith(` to ${branch}`),
					)
				);
			}
		}
		return entries.length > 0;
	}

	/**
	 * Refuses a move of a branch that would leave commits of it behind.
	 * Returns whether the run knows all that is on the branch: the branch is
	 * new here, or is as the run last handed it on.
	 */
	async function refuseLeftBehind(
		repoPath: string,
		shortId: string,
		{ branch, commit, from }: BranchMove,
	): Promise<boolean> {
		if (isRunsBranch(shortId, branch)) return false;
		if (from === null) return true;
		if ((await handedTip(repoPath, shortId, branch)) === from) return true;
		if (await isAncestor(repoPath, from, commit)) return false;
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

	/** Moves the branch, only when it is still where it was read. */
	async function moveBranch(
		cwd: string,
		{ branch, commit, from }: BranchMove,
	): Promise<void> {
		await gitOrThrow(git, cwd, [
			"update-ref",
			`refs/heads/${branch}`,
			commit,
			from ?? "0".repeat(commit.length),
		]);
	}

	/** Moves the branch back, when nothing else moved it since. */
	async function moveBack(
		cwd: string,
		{ branch, commit, from }: BranchMove,
	): Promise<void> {
		await git.run(
			cwd,
			from === null
				? ["update-ref", "-d", `refs/heads/${branch}`, commit]
				: ["update-ref", `refs/heads/${branch}`, from, commit],
		);
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
		let added = false;
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
			added = true;
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
			if (added) {
				await git.run(repoPath, [
					"worktree",
					"remove",
					"--force",
					worktreePath,
				]);
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
		const move: BranchMove = {
			branch,
			commit: await resolveCommit(repoPath, commit),
			from: await branchTip(repoPath, branch),
		};
		const known = await refuseLeftBehind(repoPath, input.shortId, move);
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
		if (known) await noteHanded(repoPath, input.shortId, branch, commit);
		return { worktreePath, branch, baseRef: commit };
	}

	return { pushRunBranch, pullRunBranch };
}
