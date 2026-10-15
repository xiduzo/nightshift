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
import { createWorktree, resolveRepoTopLevel } from "./worktrees";

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
			"Not a git repository",
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
		await expect(resolveRepoTopLevel(sub)).rejects.toThrow("not its top level");
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
		).rejects.toThrow('Unknown git ref "does-not-exist"');
	});
});
