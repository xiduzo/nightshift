import {
	afterEach,
	beforeEach,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	commitFile,
	createSandbox,
	mustGit,
	type Sandbox,
} from "../testing/test-support";
import { systemGit } from "./git";
import { branchHasOtherWork, branchInUse, notOnRemote } from "./hand-off";
import { createRunBranches } from "./run-branches";
import { keptRefsOf, worktreeLocation } from "./worktree-places";

// Each case runs real git in two copies; on a busy computer one takes over 5 s.
setDefaultTimeout(30_000);

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
		await mustGit(sandbox.root, ["init", "-q", "--bare", "-b", "main", origin]);
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

	describe("the logs git keeps in the copy", () => {
		/** A branch of a person on the first computer, with a commit of theirs, handed on from the copy. */
		async function theirFeat(before: () => Promise<unknown>) {
			await mustGit(a, ["checkout", "-q", "-b", "feat"]);
			await commit(a);
			await mustGit(a, ["checkout", "-q", "main"]);
			const theirs = await tip(a, "feat");
			await before();
			await mustGit(copyA, ["checkout", "-q", "feat"]);
			await commit(copyA);
			await take(b, await pushRunBranch(copyA, own));
			// The other computer leaves their commit out.
			await mustGit(copyB, ["reset", "-q", "--hard", `${theirs}~1`]);
			await commit(copyB);
			const back = await pushRunBranch(copyB, own);
			const was = await tip(a, "feat");
			await expect(take(a, back)).rejects.toThrow(branchHasOtherWork("feat"));
			expect(await tip(a, "feat")).toBe(was);
		}
		const branchLog = () => join(a, ".git", "logs", "refs", "heads", "feat");

		test("are known from the first commit of the branch only", async () => {
			await theirFeat(async () => {});
		});

		test("without their first lines do not make it the run's", async () => {
			await theirFeat(() => writeFile(branchLog(), ""));
		});

		test("that start later do not make it the run's", async () => {
			await theirFeat(() => rm(branchLog()));
		});
	});

	describe("work that an agent does on the branch it made", () => {
		const git = (cwd: string, ...args: string[]) =>
			mustGit(cwd, [
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@nightshift.invalid",
				"-c",
				"commit.gpgsign=false",
				...args,
			]);
		const file = async (cwd: string, name: string) => {
			await commitFile(cwd, name);
		};
		/** Someone pushes to main of the remote. */
		async function mainMoves() {
			const other = join(sandbox.root, "other");
			await mustGit(sandbox.root, [
				"clone",
				"-q",
				join(sandbox.root, "origin.git"),
				other,
			]);
			await file(other, "elsewhere.txt");
			await git(other, "push", "-q", "origin", "main");
		}
		const work: Record<string, () => Promise<unknown>> = {
			"pull --rebase": async () => {
				await mainMoves();
				await git(copyA, "pull", "-q", "--rebase", "origin", "main");
			},
			"a pull that merges": async () => {
				await mainMoves();
				await git(
					copyA,
					"pull",
					"-q",
					"--no-rebase",
					"--no-edit",
					"origin",
					"main",
				);
			},
			"reset --soft to its base, and a commit": async () => {
				await git(copyA, "reset", "-q", "--soft", "HEAD~2");
				await git(copyA, "commit", "-q", "-m", "one");
			},
			"a new name": () => git(copyA, "branch", "-m", "feat", "topic"),
		};
		for (const [name, does] of Object.entries(work)) {
			test(`${name}: goes there and back, rewritten`, async () => {
				await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
				await file(copyA, "one.txt");
				await file(copyA, "two.txt");
				await does();
				await take(b, await pushRunBranch(copyA, own));
				await commit(copyB, "--amend");
				const back = await pushRunBranch(copyB, own);
				await take(a, back);
				expect(await tip(a, back.branch)).toBe(back.commit);
			});
		}

		/** Pulls into the branch, hands it on, and takes it back without what it pulled. */
		async function withoutPulled(pull: () => Promise<unknown>) {
			await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
			await file(copyA, "one.txt");
			const base = await tip(b, "main");
			await pull();
			await file(copyA, "two.txt");
			const tipA = await tip(a, "feat");
			await take(b, await pushRunBranch(copyA, own));
			await git(copyB, "reset", "-q", "--hard", base);
			await commit(copyB, "--amend");
			const back = await pushRunBranch(copyB, own);
			await expect(take(a, back)).rejects.toThrow(branchHasOtherWork("feat"));
			expect(await tip(a, "feat")).toBe(tipA);
		}
		/** A clone of someone else, with a commit of theirs on `branch`. */
		async function someone(branch: string) {
			const there = join(sandbox.root, "someone");
			const origin = join(sandbox.root, "origin.git");
			await mustGit(sandbox.root, ["clone", "-q", origin, there]);
			await mustGit(there, ["checkout", "-q", branch]);
			await file(there, "theirs.txt");
			return there;
		}

		for (const how of ["--no-rebase", "--rebase"]) {
			test(`a commit that only a folder has stays (pull ${how})`, async () => {
				await withoutPulled(async () => {
					const there = await someone("main");
					await git(copyA, "pull", "-q", how, "--no-edit", there, "main");
				});
			});

			test(`a commit that someone put on the remote's branch stays (pull ${how})`, async () => {
				await withoutPulled(async () => {
					await mustGit(copyA, ["push", "-q", "origin", "feat"]);
					const there = await someone("feat");
					await mustGit(there, ["push", "-q", "origin", "feat"]);
					await git(copyA, "pull", "-q", how, "--no-edit", "origin", "feat");
				});
			});
		}

		for (const [name, keeps] of Object.entries({
			"names of the run": async (theirs: string) => {
				await mustGit(a, ["branch", `${own}-keep`, theirs]);
				await mustGit(a, ["push", "-q", "origin", `${own}-keep`]);
			},
			"a branch it handed on": async (theirs: string) => {
				await mustGit(a, ["tag", "their-work", theirs]);
				await mustGit(copyA, ["checkout", "-q", "-b", "other"]);
				await mustGit(copyA, ["reset", "-q", "--hard", theirs]);
				await pushRunBranch(copyA, own);
				await mustGit(copyA, ["checkout", "-q", own]);
				await mustGit(a, ["tag", "-d", "their-work"]);
			},
		})) {
			test(`a commit that only ${name} has stays`, async () => {
				const there = await someone("main");
				await mustGit(a, ["fetch", "-q", there, "main"]);
				await keeps(await mustGit(a, ["rev-parse", "FETCH_HEAD"]));
				await withoutPulled(() =>
					git(copyA, "pull", "-q", "--no-rebase", "--no-edit", there, "main"),
				);
			});
		}

		for (const gone of [false, true]) {
			test(`from the run's own branch, with work of another computer${gone ? ", that went" : ""}`, async () => {
				await commit(copyA);
				await take(b, await pushRunBranch(copyA, own));
				await commit(copyB);
				await take(a, await pushRunBranch(copyB, own));
				await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
				await commit(copyA);
				// The remote still has it.
				if (gone) await mustGit(a, ["branch", "-D", own]);
				else
					await mustGit(a, ["update-ref", "-d", `refs/remotes/origin/${own}`]);
				await take(b, await pushRunBranch(copyA, own));
				await commit(copyB, "--amend");
				const back = await pushRunBranch(copyB, own);
				await take(a, back);
				expect(await tip(a, "feat")).toBe(back.commit);
			});
		}

		/** The remote's `pr` with a commit of someone else. */
		async function pr() {
			const there = await someone("main");
			await mustGit(there, ["checkout", "-q", "-b", "pr"]);
			await file(there, "pr.txt");
			await mustGit(there, ["push", "-q", "origin", "pr"]);
			return { there, theirs: await mustGit(there, ["rev-parse", "HEAD"]) };
		}
		/** Hands `branch` on, rewritten there, and back. */
		async function rewritten(branch: string) {
			await file(copyA, "mine.txt");
			await take(b, await pushRunBranch(copyA, own));
			await commit(copyB, "--amend");
			const back = await pushRunBranch(copyB, own);
			await take(a, back);
			expect(await tip(a, branch)).toBe(back.commit);
		}
		const starts: Record<string, () => Promise<unknown>> = {
			"a pull request's branch, checked out": async () => {
				await pr();
				await mustGit(copyA, ["fetch", "-q", "origin"]);
				await mustGit(copyA, ["checkout", "-q", "pr"]);
			},
			"a branch fetched by its name": async () => {
				await pr();
				await mustGit(copyA, ["fetch", "-q", "origin", "pr:pr"]);
				await mustGit(copyA, ["checkout", "-q", "pr"]);
			},
			"a branch made, and checked out later": async () => {
				await mustGit(copyA, ["branch", "pr"]);
				await Bun.sleep(1_100);
				await mustGit(copyA, ["checkout", "-q", "pr"]);
			},
		};
		for (const [name, start] of Object.entries(starts)) {
			test(`${name}: goes there and back, rewritten`, async () => {
				await start();
				await rewritten("pr");
			});
		}

		test("a pull request's branch that the clone had from the start", async () => {
			await pr();
			const clone = join(sandbox.root, "from-start");
			await mustGit(sandbox.root, [
				"clone",
				"-q",
				join(sandbox.root, "origin.git"),
				clone,
			]);
			const copy = (await createWorktree({ repoPath: clone, shortId }))
				.worktreePath;
			// The run's own branch goes there and back first.
			await commit(copy);
			await take(b, await pushRunBranch(copy, own));
			await commit(copyB);
			await take(clone, await pushRunBranch(copyB, own));
			await mustGit(copy, ["checkout", "-q", "pr"]);
			await file(copy, "mine.txt");
			await take(b, await pushRunBranch(copy, own));
			await commit(copyB, "--amend");
			const back = await pushRunBranch(copyB, own);
			await take(clone, back);
			expect(await tip(clone, "pr")).toBe(back.commit);
		});

		test("a commit that the remote's branch had once, but not now, stays", async () => {
			const { theirs } = await pr();
			await mustGit(a, ["fetch", "-q", "origin"]);
			await mustGit(a, ["push", "-q", "-f", "origin", "main:pr"]);
			await mustGit(a, ["fetch", "-q", "origin"]);
			await mustGit(a, ["branch", "pr", theirs]);
			await mustGit(copyA, ["checkout", "-q", "pr"]);
			await file(copyA, "mine.txt");
			await take(b, await pushRunBranch(copyA, own));
			await git(copyB, "reset", "-q", "--hard", `${theirs}~1`);
			await commit(copyB);
			await expect(take(a, await pushRunBranch(copyB, own))).rejects.toThrow(
				branchHasOtherWork("pr"),
			);
			expect(await tip(a, "pr")).not.toBe(theirs);
			expect(await mustGit(a, ["branch", "--contains", theirs])).toContain(
				"pr",
			);
		});

		test("an empty branch moved on to the newest main goes there and back", async () => {
			await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
			await mainMoves();
			await mustGit(copyA, ["fetch", "-q", "origin"]);
			await git(copyA, "rebase", "-q", "origin/main");
			await rewritten("feat");
		});

		test("a move on to a person's commit is the run's only when another branch has it", async () => {
			for (const kept of [true, false]) {
				await mustGit(copyA, ["checkout", "-q", "-B", "feat", own]);
				await mustGit(copyA, ["checkout", "-q", "--detach"]);
				await mustGit(a, ["checkout", "-q", "-B", "x", own]);
				await file(a, `theirs-${kept}.txt`);
				const theirs = await tip(a, "x");
				await mustGit(a, ["checkout", "-q", "main"]);
				// The person moves feat on, from another folder.
				await mustGit(a, ["branch", "-f", "feat", theirs]);
				if (!kept) await mustGit(a, ["branch", "-D", "x"]);
				await mustGit(copyA, ["checkout", "-q", "feat"]);
				await file(copyA, `mine-${kept}.txt`);
				await take(b, await pushRunBranch(copyA, own));
				await git(copyB, "reset", "-q", "--hard", `${theirs}~1`);
				await commit(copyB);
				const back = await pushRunBranch(copyB, own);
				if (kept) {
					await take(a, back);
					expect(await tip(a, "x")).toBe(theirs);
				} else {
					await expect(take(a, back)).rejects.toThrow(
						branchHasOtherWork("feat"),
					);
				}
				await mustGit(copyB, ["checkout", "-q", "--detach"]);
				await mustGit(b, ["branch", "-D", "feat"]);
			}
		});

		test("a move by a person that left a commit out is not the run's", async () => {
			await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
			await file(copyA, "one.txt");
			await mustGit(copyA, ["checkout", "-q", "--detach"]);
			await mustGit(a, ["branch", "-f", "feat", "main"]);
			await mustGit(copyA, ["checkout", "-q", "feat"]);
			await file(copyA, "two.txt");
			await take(b, await pushRunBranch(copyA, own));
			await commit(copyB, "--amend");
			await expect(take(a, await pushRunBranch(copyB, own))).rejects.toThrow(
				branchHasOtherWork("feat"),
			);
		});

		test("a commit that comes to a pull request's branch after it was made stays", async () => {
			const { there } = await pr();
			await mustGit(copyA, ["fetch", "-q", "origin"]);
			await mustGit(copyA, ["checkout", "-q", "pr"]);
			await file(copyA, "mine.txt");
			await file(there, "more.txt");
			await mustGit(there, ["push", "-q", "origin", "pr"]);
			await git(
				copyA,
				"pull",
				"-q",
				"--no-rebase",
				"--no-edit",
				"origin",
				"pr",
			);
			await take(b, await pushRunBranch(copyA, own));
			await git(copyB, "reset", "-q", "--hard", "HEAD~2");
			await commit(copyB);
			await expect(take(a, await pushRunBranch(copyB, own))).rejects.toThrow(
				branchHasOtherWork("pr"),
			);
		});

		test("a person's branch with a commit of theirs after it was made stays", async () => {
			await mustGit(a, ["branch", "pr", own]);
			await mustGit(a, ["checkout", "-q", "pr"]);
			await file(a, "theirs.txt");
			await mustGit(a, ["checkout", "-q", "main"]);
			const theirs = await tip(a, "pr");
			await mustGit(copyA, ["checkout", "-q", "pr"]);
			await file(copyA, "mine.txt");
			await take(b, await pushRunBranch(copyA, own));
			await git(copyB, "reset", "-q", "--hard", `${theirs}~1`);
			await commit(copyB);
			await expect(take(a, await pushRunBranch(copyB, own))).rejects.toThrow(
				branchHasOtherWork("pr"),
			);
		});

		test("two branches of a person at one commit do not keep it for each other", async () => {
			await mustGit(a, ["checkout", "-q", "--detach"]);
			await file(a, "theirs.txt");
			const theirs = await mustGit(a, ["rev-parse", "HEAD"]);
			await mustGit(a, ["branch", "x", theirs]);
			await mustGit(a, ["branch", "y", theirs]);
			await mustGit(a, ["checkout", "-q", "main"]);
			for (const branch of ["x", "y"]) {
				await mustGit(copyA, ["checkout", "-q", branch]);
				await file(copyA, `${branch}.txt`);
				await take(b, await pushRunBranch(copyA, own));
				await git(copyB, "reset", "-q", "--hard", `${theirs}~1`);
				await commit(copyB);
				const back = await pushRunBranch(copyB, own);
				if (branch === "x") {
					await take(a, back);
				} else {
					await expect(take(a, back)).rejects.toThrow(branchHasOtherWork("y"));
				}
				await mustGit(copyA, ["checkout", "-q", own]);
			}
			expect(await mustGit(a, ["branch", "--contains", theirs])).toContain("y");
		});

		test("a commit that a tag has is kept by it", async () => {
			const there = await someone("main");
			await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
			await file(copyA, "one.txt");
			await git(copyA, "pull", "-q", "--no-rebase", "--no-edit", there, "main");
			await mustGit(a, ["tag", "their-work", "feat^2"]);
			await take(b, await pushRunBranch(copyA, own));
			await commit(copyB, "--amend");
			const back = await pushRunBranch(copyB, own);
			await take(a, back);
			expect(await tip(a, "feat")).toBe(back.commit);
		});

		test("a person's branch that it merged stays where it is", async () => {
			await mustGit(a, ["checkout", "-q", "-b", "theirs"]);
			await file(a, "theirs.txt");
			await mustGit(a, ["checkout", "-q", "main"]);
			const theirs = await tip(a, "theirs");
			await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
			await file(copyA, "one.txt");
			await git(copyA, "pull", "-q", "--no-rebase", "--no-edit", ".", "theirs");
			await take(b, await pushRunBranch(copyA, own));
			await git(copyB, "reset", "-q", "--hard", "HEAD~1");
			await take(a, await pushRunBranch(copyB, own));
			expect(await tip(a, "theirs")).toBe(theirs);
			// Nor does it become the run's.
			await mustGit(copyA, ["checkout", "-q", "theirs"]);
			await git(copyA, "pull", "-q", "--ff", ".", "feat").catch(() => {});
			await commit(copyA);
			const sent = await pushRunBranch(copyA, own);
			await mustGit(copyA, [
				"push",
				"-q",
				"-f",
				"origin",
				`${sent.commit}~1:theirs`,
			]);
			await mustGit(a, ["push", "-q", "-f", "origin", "main:theirs"]);
			await expect(
				take(a, { branch: "theirs", commit: await tip(a, "main") }),
			).rejects.toThrow(branchHasOtherWork("theirs"));
		});
	});

	test("work that the remote's branch does not have is not taken", async () => {
		const sent = await handFeat();
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
		for (const branch of ["feat", own]) {
			const before = [await refs(b), await copies(b)];
			await expect(take(b, { branch, commit: theirs })).rejects.toThrow(
				notOnRemote(branch),
			);
			expect([await refs(b), await copies(b)]).toEqual(before);
		}
		// What the remote's branch had before is on it too.
		await commit(copyA);
		await pushRunBranch(copyA, own);
		await take(b, sent);
	});

	test("work that someone else replaced on the remote before it came is not taken", async () => {
		await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
		await commit(copyA);
		const sent = await pushRunBranch(copyA, own);
		const before = [await refs(b), await copies(b)];
		await mustGit(a, ["push", "-q", "-f", "origin", "main:feat"]);
		await expect(take(b, sent)).rejects.toThrow(notOnRemote("feat"));
		expect([await refs(b), await copies(b)]).toEqual(before);
		// Handed on again, it comes.
		await take(b, await pushRunBranch(copyA, own));
		expect(await tip(b, "feat")).toBe(sent.commit);
	});

	test("a clone that is not deep takes the work, and hands it back", async () => {
		const shallow = join(sandbox.root, "shallow", "clone");
		await mkdir(join(sandbox.root, "shallow"));
		await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
		await commit(copyA);
		await commit(copyA);
		await mustGit(sandbox.root, [
			"clone",
			"-q",
			"--depth",
			"1",
			`file://${join(sandbox.root, "origin.git")}`,
			shallow,
		]);
		const there = worktreeLocation(shallow, shortId).worktreePath;
		await take(shallow, await pushRunBranch(copyA, own));
		await commit(there, "--amend");
		const back = await pushRunBranch(there, own);
		await take(a, back);
		expect(await tip(a, "feat")).toBe(back.commit);
		await commit(copyA, "--amend");
		const again = await pushRunBranch(copyA, own);
		await take(shallow, again);
		expect(await tip(shallow, "feat")).toBe(again.commit);
	});

	test("the work on no branch goes on the run's own", async () => {
		await mustGit(copyA, ["checkout", "-q", "--detach"]);
		await commit(copyA);
		const sent = await pushRunBranch(copyA, own);
		expect(sent.branch).toBe(own);
		await take(b, sent);
		expect(await tip(b, own)).toBe(sent.commit);
	});

	test("a hook that fails leaves no copy, and the branch as it was", async () => {
		const sent = await handFeat();
		await mustGit(b, ["worktree", "remove", copyB]);
		await writeFile(
			join(b, ".git", "hooks", "post-checkout"),
			"#!/bin/sh\nexit 1\n",
			{ mode: 0o755 },
		);
		await commit(copyA, "--amend");
		const again = await pushRunBranch(copyA, own);
		const before = [await refs(b), await copies(b)];
		await expect(take(b, again)).rejects.toThrow();
		expect([await refs(b), await copies(b)]).toEqual(before);
		expect(existsSync(copyB)).toBe(false);
		await rm(join(b, ".git", "hooks", "post-checkout"));
		await take(b, again);
		expect(await currentBranch(copyB)).toBe("feat");
		expect(sent.commit).not.toBe(again.commit);
	});

	test("what was at the place of the copy stays", async () => {
		const sent = await handFeat();
		await mustGit(b, ["worktree", "remove", copyB]);
		await writeFile(copyB, "a file\n");
		await expect(take(b, sent)).rejects.toThrow();
		expect(await readFile(copyB, "utf8")).toBe("a file\n");
	});

	test("a branch that a person removed there is taken again", async () => {
		await handFeat();
		await mustGit(copyB, ["checkout", "-q", "--detach"]);
		await mustGit(b, ["branch", "-D", "feat"]);
		for (let times = 0; times < 2; times++) {
			await commit(copyA, "--amend");
			const again = await pushRunBranch(copyA, own);
			await take(b, again);
			expect(await tip(b, "feat")).toBe(again.commit);
		}
	});

	test("a copy that is gone, but that git still knows, stays known", async () => {
		const sent = await handFeat();
		await rm(copyB, { recursive: true });
		const before = [await refs(b), await copies(b)];
		await expect(take(b, sent)).rejects.toThrow();
		expect([await refs(b), await copies(b)]).toEqual(before);
	});

	test("a branch moves together with its note", async () => {
		await handFeat();
		await commit(copyA, "--amend");
		const again = await pushRunBranch(copyA, own);
		const before = await refs(b);
		const note = keptRefsOf(shortId).handed("feat");
		const theirs = await tip(b, "main");
		const racing = gitWith(async (_args, input) => {
			if (input !== "") await mustGit(b, ["update-ref", note, theirs]);
		});
		await expect(
			racing.pullRunBranch({ repoPath: b, shortId, ...again }),
		).rejects.toThrow();
		await mustGit(b, ["update-ref", note, await tip(b, "feat")]);
		expect(await refs(b)).toBe(before);
	});

	test("a branch that got commits after the move is not put back", async () => {
		for (const isNew of [true, false]) {
			if (isNew) await mustGit(copyA, ["checkout", "-q", "-b", "feat"]);
			else await take(b, await pushRunBranch(copyA, own));
			await commit(copyA);
			const sent = await pushRunBranch(copyA, own);
			let theirs = "";
			const fails = gitWith(async (args) => {
				if (args[0] !== "checkout" || args[2] !== "feat" || theirs !== "")
					return;
				theirs = await mustGit(b, [
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
				await mustGit(b, ["update-ref", "refs/heads/feat", theirs]);
				throw new Error("no checkout");
			});
			await expect(
				fails.pullRunBranch({ repoPath: b, shortId, ...sent }),
			).rejects.toThrow("no checkout");
			expect(await tip(b, "feat")).toBe(theirs);
			await mustGit(b, ["worktree", "prune"]);
			if (existsSync(copyB)) await mustGit(b, ["worktree", "remove", copyB]);
			await mustGit(b, ["branch", "-D", "feat"]);
		}
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
		await mustGit(a, [
			"push",
			"-q",
			"-f",
			"origin",
			`${again.commit}:refs/heads/feat`,
		]);
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
	function gitWith(
		before: (args: string[], input: string) => Promise<void> | undefined,
	) {
		const system = systemGit();
		return createWorktrees({
			...system,
			run: async (cwd, args, options) => {
				await before(args, options?.input ?? "");
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
			const racing = gitWith(async (_args, input) => {
				if (done || !input.startsWith("update refs/heads/feat ")) return;
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
		const racing = gitWith(async (_args, input) => {
			if (input.startsWith("update refs/heads/feat "))
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
