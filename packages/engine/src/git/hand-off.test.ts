import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import {
	commitFile,
	createSandbox,
	mustGit,
	type Sandbox,
} from "../testing/test-support";
import { systemGit } from "./git";
import { branchHasOtherWork, branchInUse } from "./hand-off";
import { createRunBranches } from "./run-branches";
import { keptRefsOf, worktreeLocation } from "./worktree-places";
import {
	createWorktree,
	createWorktrees,
	currentBranch,
	pullRunBranch,
	pushRunBranch,
	restoreWorktree,
	uncommittedChanges,
} from "./worktrees";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

describe("a hand-off of a branch the run made", () => {
	const shortId = "abcdef12";
	const own = `nightshift/${shortId}`;
	/** Two computers with a clone each of one remote, and the run's copy on the first. */
	let a: string;
	let b: string;
	let copyA: string;
	let copyB: string;
	beforeEach(async () => {
		const origin = join(sandbox.root, "origin.git");
		await mustGit(sandbox.root, ["init", "-q", "--bare", origin]);
		a = sandbox.repoPath;
		await mustGit(a, ["remote", "add", "origin", origin]);
		await mustGit(a, ["push", "-q", "origin", "HEAD"]);
		b = join(sandbox.root, "there", "clone");
		await mkdir(join(sandbox.root, "there"));
		await mustGit(sandbox.root, ["clone", "-q", origin, b]);
		copyA = (await createWorktree({ repoPath: a, shortId })).worktreePath;
		copyB = worktreeLocation(b, shortId).worktreePath;
	});
	const commit = (cwd: string, ...extra: string[]) =>
		mustGit(cwd, [
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@nightshift.invalid",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-q",
			"--allow-empty",
			"-m",
			`work ${Math.random()}`,
			...extra,
		]);
	const commitSubject = (cwd: string, subject: string) =>
		mustGit(cwd, [
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@nightshift.invalid",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-q",
			"--allow-empty",
			"-m",
			subject,
		]);
	const tip = (cwd: string, branch: string) =>
		mustGit(cwd, ["rev-parse", `refs/heads/${branch}`]);
	const refs = (cwd: string) =>
		mustGit(cwd, [
			"for-each-ref",
			"--format=%(objectname) %(refname)",
			"refs/heads",
			"refs/nightshift",
		]);
	const copies = (cwd: string) => mustGit(cwd, ["worktree", "list"]);
	const take = (
		repoPath: string,
		sent: { branch: string; commit: string },
		run = shortId,
	) => pullRunBranch({ repoPath, shortId: run, ...sent });

	/** The run makes `feat` in its copy on the first computer, and hands it on. */
	async function handFeat() {
		await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
		await commit(copyA);
		const sent = await pushRunBranch(copyA, own);
		await take(b, sent);
		return sent;
	}

	test("goes there and back, also when it was rewritten", async () => {
		const sent = await handFeat();
		expect(await currentBranch(copyB)).toBe("feat");
		expect(await tip(b, "feat")).toBe(sent.commit);
		// Rewritten on the second computer, and back.
		await commit(copyB, "--amend");
		await commit(copyB);
		const back = await pushRunBranch(copyB, own);
		expect((await take(a, back)).worktreePath).toBe(copyA);
		expect(await tip(a, "feat")).toBe(back.commit);
		expect(await currentBranch(copyA)).toBe("feat");
		expect(await uncommittedChanges(copyA)).toEqual([]);
		// Rewritten on the first computer, and on again.
		await commit(copyA, "--amend");
		const again = await pushRunBranch(copyA, own);
		await take(b, again);
		expect(await tip(b, "feat")).toBe(again.commit);
		// Rewritten in turns.
		await commit(copyB, "--amend");
		await take(a, await pushRunBranch(copyB, own));
		await commit(copyA, "--amend");
		await take(b, await pushRunBranch(copyA, own));
		// Once more, after the copy there went.
		await mustGit(b, ["worktree", "remove", copyB]);
		await commit(copyA, "--amend");
		const last = await pushRunBranch(copyA, own);
		await take(b, last);
		expect(await tip(b, "feat")).toBe(last.commit);
		expect(await currentBranch(copyB)).toBe("feat");
	});

	test("also when it was rebased", async () => {
		await handFeat();
		await mustGit(copyB, ["checkout", "-q", "--detach", "origin/HEAD"]);
		await commitFile(copyB, "base.txt");
		const onto = await mustGit(copyB, ["rev-parse", "HEAD"]);
		await mustGit(copyB, ["checkout", "-q", "feat"]);
		await commitFile(copyB, "mine.txt");
		await mustGit(copyB, [
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@nightshift.invalid",
			"rebase",
			"-q",
			onto,
		]);
		const back = await pushRunBranch(copyB, own);
		await take(a, back);
		const next = await (async () => {
			await commit(copyA, "--amend");
			return pushRunBranch(copyA, own);
		})();
		await take(b, next);
		expect(await tip(b, "feat")).toBe(next.commit);
	});

	test("a branch that only gets more commits moves on", async () => {
		await mustGit(b, ["branch", "feat"]);
		const sent = await handFeat();
		expect(await tip(b, "feat")).toBe(sent.commit);
	});

	test("the run's own names move as the run says", async () => {
		for (const name of [own, `${own}-1-item`]) {
			await mustGit(copyA, ["checkout", "-q", "-B", name]);
			await commit(copyA);
			await take(b, await pushRunBranch(copyA, own));
			await commit(copyA, "--amend");
			const again = await pushRunBranch(copyA, own);
			await take(b, again);
			expect(await tip(b, name)).toBe(again.commit);
		}
	});

	test("the run's own names move whatever they were at, and are not noted", async () => {
		const item = `${own}-1-item`;
		for (const name of [own, item]) {
			await mustGit(b, ["checkout", "-q", "-b", name]);
			await commit(b);
			await mustGit(b, ["checkout", "-q", "main"]);
			await mustGit(copyA, ["checkout", "-q", "-B", name]);
			await commit(copyA);
			const sent = await pushRunBranch(copyA, own);
			await take(b, sent);
			expect(await tip(b, name)).toBe(sent.commit);
		}
		const { listKept } = createRunBranches(systemGit());
		expect([await listKept(a), await listKept(b)]).toEqual([
			new Map(),
			new Map(),
		]);
	});

	describe("by git's own logs", () => {
		afterEach(() => {
			delete process.env.GIT_COMMITTER_DATE;
		});
		const at = (seconds: number) => {
			process.env.GIT_COMMITTER_DATE = `@${1_700_000_000 + seconds} +0000`;
		};
		/** What the run noted on the first computer, after it handed `feat` on. */
		const noted = async () => {
			await pushRunBranch(copyA, own);
			return (await createRunBranches(systemGit()).listKept(a)).get(shortId);
		};

		test("the run's: made with a checkout in its copy", async () => {
			at(1);
			await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
			at(2);
			await commit(copyA);
			expect(await noted()).toEqual([keptRefsOf(shortId).handed("feat")]);
		});

		test("the run's: made from a commit of the run", async () => {
			at(1);
			await commit(copyA);
			await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
			expect(await noted()).toEqual([keptRefsOf(shortId).handed("feat")]);
		});

		test("not known, without logs", async () => {
			await mustGit(a, ["config", "core.logAllRefUpdates", "false"]);
			await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
			await commit(copyA);
			expect(await noted()).toBeUndefined();
		});

		test("a person's: made before the copy took it", async () => {
			at(1);
			await mustGit(a, ["branch", "feat", own]);
			at(2);
			await mustGit(copyA, ["checkout", "-q", "feat"]);
			await commit(copyA);
			expect(await noted()).toBeUndefined();
		});

		test("a person's: made while the copy did something else", async () => {
			at(1);
			await mustGit(a, ["branch", "feat", own]);
			await mustGit(copyA, ["checkout", "-q", "-b", "other"]);
			await commitSubject(copyA, "go to feat");
			at(2);
			await mustGit(copyA, ["checkout", "-q", "feat"]);
			expect(await noted()).toBeUndefined();
		});

		test("a person's: a commit came to it that the copy did not make", async () => {
			at(1);
			await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
			await mustGit(copyA, ["checkout", "-q", "--detach"]);
			const theirs = await mustGit(a, [
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@nightshift.invalid",
				"commit-tree",
				"-p",
				"feat",
				"-m",
				"theirs",
				"feat^{tree}",
			]);
			await mustGit(a, ["update-ref", "refs/heads/feat", theirs]);
			await mustGit(copyA, ["checkout", "-q", "feat"]);
			await commit(copyA);
			expect(await noted()).toBeUndefined();
		});
	});

	test("a branch there with commits of its own stays as it is", async () => {
		await mustGit(b, ["checkout", "-q", "-b", "feat"]);
		await commit(b);
		await mustGit(b, ["checkout", "-q", "-"]);
		await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
		await commit(copyA);
		const sent = await pushRunBranch(copyA, own);
		const before = [await refs(b), await copies(b)];
		await expect(take(b, sent)).rejects.toThrow(branchHasOtherWork("feat"));
		expect([await refs(b), await copies(b)]).toEqual(before);
		expect(existsSync(copyB)).toBe(false);
		// Also when the run's copy is there.
		await take(b, { branch: own, commit: await tip(a, own) });
		const then = [await refs(b), await copies(b)];
		await expect(take(b, sent)).rejects.toThrow(branchHasOtherWork("feat"));
		expect([await refs(b), await copies(b)]).toEqual(then);
		expect(await currentBranch(copyB)).toBe(own);
	});

	test("a branch there that got other commits since stays as it is", async () => {
		const sent = await handFeat();
		// A person's commit on the branch, from another folder.
		const theirs = await mustGit(b, [
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@nightshift.invalid",
			"commit-tree",
			"-p",
			sent.commit,
			"-m",
			"theirs",
			`${sent.commit}^{tree}`,
		]);
		await mustGit(copyB, ["checkout", "-q", "--detach"]);
		await mustGit(b, ["update-ref", "refs/heads/feat", theirs]);
		await commit(copyA, "--amend");
		const again = await pushRunBranch(copyA, own);
		await expect(take(b, again)).rejects.toThrow(branchHasOtherWork("feat"));
		expect(await tip(b, "feat")).toBe(theirs);
		// Handing it on does not make that commit the run's.
		await mustGit(copyB, ["checkout", "-q", "feat"]);
		await commit(copyB);
		const mixed = await pushRunBranch(copyB, own);
		await expect(
			take(b, { branch: "feat", commit: again.commit }),
		).rejects.toThrow(branchHasOtherWork("feat"));
		expect(await tip(b, "feat")).toBe(mixed.commit);
	});

	test("a person's branch is never the run's, whatever the run took before", async () => {
		await mustGit(b, ["checkout", "-q", "-b", "feat"]);
		await commit(b);
		await mustGit(b, ["push", "-q", "origin", "feat"]);
		await mustGit(b, ["checkout", "-q", "-"]);
		const theirs = await tip(b, "feat");
		const other = await tip(a, own);
		// The tip it has, also under a name of the run and a new one.
		await mustGit(a, ["fetch", "-q", "origin"]);
		await mustGit(b, ["branch", "copy", theirs]);
		await mustGit(b, ["push", "-q", "origin", "copy", `copy:${own}`]);
		await mustGit(b, ["branch", "-D", "copy"]);
		await take(b, { branch: own, commit: theirs });
		await take(b, { branch: "copy", commit: theirs });
		await take(b, { branch: "feat", commit: theirs });
		await pushRunBranch(copyB, own);
		await expect(take(b, { branch: "feat", commit: other })).rejects.toThrow(
			branchHasOtherWork("feat"),
		);
		expect(await tip(b, "feat")).toBe(theirs);
	});

	test("another run does not take over what this run handed on", async () => {
		await handFeat();
		await mustGit(copyB, ["checkout", "-q", "--detach"]);
		await commit(copyA, "--amend");
		const sent = await pushRunBranch(copyA, own);
		await expect(take(b, sent, "bbbbbbbb")).rejects.toThrow(
			branchHasOtherWork("feat"),
		);
	});

	test("the copy is the same one through a link to the clone's folder", async () => {
		await handFeat();
		const link = join(sandbox.root, "linked");
		await symlink(join(sandbox.root, "there"), link);
		await commit(copyA);
		const sent = await pushRunBranch(copyA, own);
		await take(join(link, "clone"), sent);
		expect(await tip(b, "feat")).toBe(sent.commit);
	});

	test("a branch a person has open in another folder stays as it is", async () => {
		await mustGit(b, ["checkout", "-q", "-b", "feat"]);
		await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
		await commit(copyA);
		const sent = await pushRunBranch(copyA, own);
		const before = [await refs(b), await copies(b)];
		await expect(take(b, sent)).rejects.toThrow(branchInUse("feat"));
		expect([await refs(b), await copies(b)]).toEqual(before);
		expect(await uncommittedChanges(b)).toEqual([]);
	});

	/** Git as it is, with something that happens right before one command. */
	function gitWith(before: (args: string[]) => Promise<void> | undefined) {
		const system = systemGit();
		return createWorktrees({
			...system,
			run: async (cwd, args, options) => {
				await before(args);
				return system.run(cwd, args, options);
			},
		});
	}

	test("a commit that comes while it moves stays, and the copy is as it was", async () => {
		await handFeat();
		for (const withCopy of [true, false]) {
			if (!withCopy) await mustGit(b, ["worktree", "remove", copyB]);
			await commit(copyA);
			const sent = await pushRunBranch(copyA, own);
			const theirs = await mustGit(b, [
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@nightshift.invalid",
				"commit-tree",
				"-p",
				await tip(b, "feat"),
				"-m",
				"theirs",
				"feat^{tree}",
			]);
			const was = await tip(b, "feat");
			let done = false;
			const racing = gitWith(async (args) => {
				if (done || args[0] !== "update-ref" || args[1] !== "refs/heads/feat")
					return;
				done = true;
				await mustGit(b, ["update-ref", "refs/heads/feat", theirs]);
			});
			await expect(
				racing.pullRunBranch({ repoPath: b, shortId, ...sent }),
			).rejects.toThrow();
			expect(done).toBe(true);
			expect(await tip(b, "feat")).toBe(theirs);
			expect(existsSync(copyB)).toBe(withCopy);
			if (withCopy) {
				expect(await currentBranch(copyB)).toBe("feat");
				expect(await uncommittedChanges(copyB)).toEqual([]);
			}
			await mustGit(b, ["update-ref", "refs/heads/feat", was]);
		}
	});

	test("a new branch that comes while it moves stays", async () => {
		await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
		await commit(copyA);
		const sent = await pushRunBranch(copyA, own);
		const theirs = await tip(b, (await currentBranch(b)) as string);
		const racing = gitWith(async (args) => {
			if (args[0] === "update-ref" && args[1] === "refs/heads/feat")
				await mustGit(b, ["branch", "-f", "feat", theirs]);
		});
		await expect(
			racing.pullRunBranch({ repoPath: b, shortId, ...sent }),
		).rejects.toThrow();
		expect(await tip(b, "feat")).toBe(theirs);
		expect(existsSync(copyB)).toBe(false);
	});

	test("a move that fails at its end puts everything back", async () => {
		const fails = gitWith(async (args) => {
			if (args[0] === "checkout" && args[2] === "feat" && args[3] === "--")
				throw new Error("no checkout");
		});
		await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
		await commit(copyA);
		const sent = await pushRunBranch(copyA, own);
		// Its branch is new, and so is the copy.
		let before = [await refs(b), await copies(b)];
		await expect(
			fails.pullRunBranch({ repoPath: b, shortId, ...sent }),
		).rejects.toThrow("no checkout");
		expect([await refs(b), await copies(b)]).toEqual(before);
		// Its branch and the copy were there.
		await mustGit(b, ["branch", "feat"]);
		await take(b, { branch: own, commit: await tip(a, own) });
		before = [await refs(b), await copies(b)];
		await expect(
			fails.pullRunBranch({ repoPath: b, shortId, ...sent }),
		).rejects.toThrow("no checkout");
		expect([await refs(b), await copies(b)]).toEqual(before);
		expect(await currentBranch(copyB)).toBe(own);
		// The copy was on a commit, not on a branch.
		await mustGit(copyB, ["checkout", "-q", "--detach"]);
		await expect(
			fails.pullRunBranch({ repoPath: b, shortId, ...sent }),
		).rejects.toThrow("no checkout");
		expect(await currentBranch(copyB)).toBeNull();
	});

	test("the cleanup removes what it noted, and a copy made again keeps it", async () => {
		const base = await mustGit(b, ["rev-parse", "HEAD"]);
		await mustGit(a, ["push", "-q", "origin", `${base}:refs/heads/feat`]);
		await take(b, { branch: "feat", commit: base });
		const { listKept, deleteRef } = createRunBranches(systemGit());
		const noted = (await listKept(b)).get(shortId) ?? [];
		expect(noted).toEqual([keptRefsOf(shortId).handed("feat")]);
		await mustGit(b, ["worktree", "remove", copyB]);
		await restoreWorktree({
			repoPath: b,
			shortId,
			baseRef: await mustGit(b, ["rev-parse", "HEAD"]),
		});
		expect((await listKept(b)).get(shortId)).toEqual(noted);
		for (const ref of noted) await deleteRef(b, ref);
		expect(await listKept(b)).toEqual(new Map());
	});
});
