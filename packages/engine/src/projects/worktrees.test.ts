import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
	commitFile,
	createSandbox,
	mustGit,
	type Sandbox,
} from "../testing/test-support";
import {
	baseDiverged,
	baseNotFetched,
	branchExists,
	checkoutBranch,
	createAndCheckoutBranch,
	createWorktree,
	currentBranch,
	freeBranchName,
	itemBranchName,
	listBranches,
	resolveRepoTopLevel,
	slugify,
	uncommittedChanges,
} from "./worktrees";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

describe("resolveRepoTopLevel", () => {
	test("accepts the top level of a repository", async () => {
		expect(await resolveRepoTopLevel(sandbox.repoPath)).toBe(sandbox.repoPath);
	});

	test("rejects a directory that is not a repository", async () => {
		const plain = join(sandbox.root, "plain");
		await mkdir(plain);
		await expect(resolveRepoTopLevel(plain)).rejects.toThrow(
			"is not a git repository",
		);
	});

	test("rejects a path that does not exist", async () => {
		await expect(
			resolveRepoTopLevel(join(sandbox.root, "missing")),
		).rejects.toThrow("does not exist");
	});

	test("rejects a subdirectory of a repository", async () => {
		const sub = join(sandbox.repoPath, "sub");
		await mkdir(sub);
		await expect(resolveRepoTopLevel(sub)).rejects.toThrow(
			"not the top folder",
		);
	});
});

describe("createWorktree", () => {
	test("adds a sibling worktree on a new branch from HEAD", async () => {
		const head = await mustGit(sandbox.repoPath, ["rev-parse", "HEAD"]);
		const worktree = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "abcd1234",
		});
		expect(worktree).toEqual({
			worktreePath: join(sandbox.root, "repo.nightshift", "abcd1234"),
			branch: "nightshift/abcd1234",
			baseRef: head,
		});
		expect(existsSync(join(worktree.worktreePath, "README.md"))).toBe(true);
		expect(
			await mustGit(worktree.worktreePath, [
				"rev-parse",
				"--abbrev-ref",
				"HEAD",
			]),
		).toBe("nightshift/abcd1234");
	});

	test("resolves an explicit base ref to a commit", async () => {
		const first = await mustGit(sandbox.repoPath, ["rev-parse", "HEAD"]);
		await commitFile(sandbox.repoPath, "second.txt");
		const worktree = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "base0001",
			baseRef: "HEAD~1",
		});
		expect(worktree.baseRef).toBe(first);
		expect(existsSync(join(worktree.worktreePath, "second.txt"))).toBe(false);
	});

	test("rejects an unknown base ref", async () => {
		await expect(
			createWorktree({
				repoPath: sandbox.repoPath,
				shortId: "nope0001",
				baseRef: "does-not-exist",
			}),
		).rejects.toThrow('The branch or commit "does-not-exist"');
	});
});

describe("createWorktree from a branch a remote has", () => {
	let remotePath: string;
	let otherPath: string;

	/** A commit on the remote's main, made from another clone. */
	async function pushFromElsewhere(name: string): Promise<string> {
		await commitFile(otherPath, name);
		await mustGit(otherPath, ["push", "-q", "origin", "main"]);
		return mustGit(otherPath, ["rev-parse", "HEAD"]);
	}

	const head = (ref = "HEAD") => mustGit(sandbox.repoPath, ["rev-parse", ref]);

	beforeEach(async () => {
		remotePath = join(sandbox.root, "remote.git");
		otherPath = join(sandbox.root, "other");
		await mustGit(sandbox.root, ["init", "-q", "--bare", remotePath]);
		await mustGit(sandbox.repoPath, ["remote", "add", "origin", remotePath]);
		await mustGit(sandbox.repoPath, ["push", "-q", "-u", "origin", "main"]);
		await mustGit(sandbox.root, [
			"clone",
			"-q",
			"-b",
			"main",
			remotePath,
			otherPath,
		]);
	});

	/** The person's refs and checkout, which a run start never moves. */
	async function personsRefs() {
		return {
			main: await head("refs/heads/main"),
			originMain: await head("refs/remotes/origin/main"),
			checkedOut: await currentBranch(sandbox.repoPath),
			changes: await uncommittedChanges(sandbox.repoPath),
		};
	}

	async function expectNoFetchRefLeft() {
		const refs = await mustGit(sandbox.repoPath, [
			"for-each-ref",
			"refs/nightshift",
		]);
		expect(refs).toBe("");
	}

	test("starts at the remote's commit when the remote is ahead", async () => {
		const before = await personsRefs();
		const newest = await pushFromElsewhere("merged.txt");
		const worktree = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "ahead001",
			baseRef: "main",
		});
		expect(worktree.baseRef).toBe(newest);
		expect(worktree.warning).toBeUndefined();
		expect(existsSync(join(worktree.worktreePath, "merged.txt"))).toBe(true);
		expect(await personsRefs()).toEqual(before);
		await expectNoFetchRefLeft();
	});

	test("fetches from origin for a branch without an upstream", async () => {
		await mustGit(sandbox.repoPath, ["branch", "--unset-upstream", "main"]);
		const newest = await pushFromElsewhere("merged.txt");
		const worktree = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "noup0001",
			baseRef: "main",
		});
		expect(worktree.baseRef).toBe(newest);
		expect(worktree.warning).toBeUndefined();
	});

	test("a remote-tracking base ref starts at the remote's commit too", async () => {
		const newest = await pushFromElsewhere("merged.txt");
		const worktree = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "track001",
			baseRef: "origin/main",
		});
		expect(worktree.baseRef).toBe(newest);
		expect(worktree.warning).toBeUndefined();
	});

	test("starts at the local commit when the local branch is ahead", async () => {
		await commitFile(sandbox.repoPath, "unpushed.txt");
		const local = await head();
		const worktree = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "local001",
			baseRef: "main",
		});
		expect(worktree.baseRef).toBe(local);
		expect(worktree.warning).toBeUndefined();
	});

	test("starts at the local commit with a warning when the two went apart", async () => {
		await pushFromElsewhere("merged.txt");
		await commitFile(sandbox.repoPath, "unpushed.txt");
		const before = await personsRefs();
		const worktree = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "apart001",
			baseRef: "main",
		});
		expect(worktree.baseRef).toBe(before.main);
		expect(worktree.warning).toBe(baseDiverged("main"));
		expect(await personsRefs()).toEqual(before);
		await expectNoFetchRefLeft();
	});

	test("starts at the local commit with a warning when the remote cannot be reached", async () => {
		await mustGit(sandbox.repoPath, [
			"remote",
			"set-url",
			"origin",
			join(sandbox.root, "gone.git"),
		]);
		const local = await head();
		const worktree = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "gone0001",
			baseRef: "main",
		});
		expect(worktree.baseRef).toBe(local);
		expect(worktree.warning).toBe(baseNotFetched("main"));
	});

	test("a commit or a tag as base ref fetches nothing", async () => {
		const local = await head();
		await mustGit(sandbox.repoPath, ["tag", "v1"]);
		await mustGit(sandbox.repoPath, [
			"remote",
			"set-url",
			"origin",
			join(sandbox.root, "gone.git"),
		]);
		for (const [shortId, baseRef] of [
			["sha00001", local],
			["tag00001", "v1"],
		] as const) {
			const worktree = await createWorktree({
				repoPath: sandbox.repoPath,
				shortId,
				baseRef,
			});
			expect(worktree.baseRef).toBe(local);
			expect(worktree.warning).toBeUndefined();
		}
	});

	test("a branch only this clone has fetches nothing", async () => {
		await mustGit(sandbox.repoPath, ["branch", "only-here"]);
		await mustGit(sandbox.repoPath, [
			"remote",
			"set-url",
			"origin",
			join(sandbox.root, "gone.git"),
		]);
		const worktree = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "here0001",
			baseRef: "only-here",
		});
		expect(worktree.baseRef).toBe(await head());
		expect(worktree.warning).toBeUndefined();
	});
});

describe("listBranches", () => {
	test("lists local and remote branches, without the remote's HEAD", async () => {
		await mustGit(sandbox.repoPath, ["branch", "feature/a"]);
		const head = await mustGit(sandbox.repoPath, ["rev-parse", "HEAD"]);
		await mustGit(sandbox.repoPath, [
			"update-ref",
			"refs/remotes/origin/main",
			head,
		]);
		await mustGit(sandbox.repoPath, [
			"symbolic-ref",
			"refs/remotes/origin/HEAD",
			"refs/remotes/origin/main",
		]);
		const branches = await listBranches(sandbox.repoPath);
		expect(branches.current).toBe("main");
		expect(branches.local.toSorted()).toEqual(["feature/a", "main"]);
		expect(branches.remote).toEqual(["origin/main"]);
	});
});

describe("item branches", () => {
	test("names are git-safe, from the item id and title, beside the run's branch", () => {
		expect(slugify("  Add Login — über Fast!! ")).toBe("add-login-uber-fast");
		expect(slugify("a".repeat(60))).toHaveLength(48);
		expect(
			itemBranchName("abcd1234", { id: "12", title: "Add: the/login" }),
		).toBe("nightshift/abcd1234-12-add-the-login");
		expect(itemBranchName("abcd1234", { id: "!", title: "?" })).toBe(
			"nightshift/abcd1234-item",
		);
	});

	test("create, check out, find a free name, and refuse a dirty worktree", async () => {
		const worktree = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "abcd1234",
		});
		const wt = worktree.worktreePath;
		// Beside the run's branch: git cannot nest a branch inside another's name.
		const name = itemBranchName("abcd1234", { id: "1", title: "a" });
		expect(await freeBranchName(wt, name)).toBe(name);
		await createAndCheckoutBranch(wt, name, worktree.branch);
		expect(await currentBranch(wt)).toBe(name);
		expect(await branchExists(wt, name)).toBe(true);
		expect(await freeBranchName(wt, name)).toBe(`${name}-2`);

		await commitFile(wt, "one.txt");
		await checkoutBranch(wt, worktree.branch);
		expect(await currentBranch(wt)).toBe(worktree.branch);
		expect(existsSync(join(wt, "one.txt"))).toBe(false);

		await Bun.write(join(wt, "loose.txt"), "x");
		expect(await uncommittedChanges(wt)).toEqual(["?? loose.txt"]);
		await expect(
			createAndCheckoutBranch(wt, `${name}-2`, name),
		).rejects.toThrow("Night Shift does not commit for you");
		await expect(checkoutBranch(wt, name)).rejects.toThrow("loose.txt");
		expect(await currentBranch(wt)).toBe(worktree.branch);
		expect(await branchExists(wt, `${name}-2`)).toBe(false);

		await mustGit(wt, ["checkout", "-q", "--detach"]);
		expect(await currentBranch(wt)).toBeNull();
	});
});
