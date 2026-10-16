import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
	commitFile,
	createSandbox,
	mustGit,
	type Sandbox,
} from "./test-support";
import {
	branchExists,
	checkoutBranch,
	createAndCheckoutBranch,
	createWorktree,
	currentBranch,
	freeBranchName,
	itemBranchName,
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
