import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import {
	commitFile,
	createSandbox,
	mustGit,
	type Sandbox,
} from "../testing/test-support";
import { systemGit } from "./git";
import { createRunBranches } from "./run-branches";
import { createWorktree } from "./worktrees";

const branches = createRunBranches(systemGit());

let sandbox: Sandbox;
let base: string;
beforeEach(async () => {
	sandbox = await createSandbox();
	const origin = join(sandbox.root, "origin.git");
	await mustGit(sandbox.root, ["init", "-q", "--bare", origin]);
	await mustGit(sandbox.repoPath, ["remote", "add", "origin", origin]);
	await mustGit(sandbox.repoPath, ["push", "-q", "origin", "main"]);
	await mustGit(sandbox.repoPath, [
		"symbolic-ref",
		"refs/remotes/origin/HEAD",
		"refs/remotes/origin/main",
	]);
	base = await mustGit(sandbox.repoPath, ["rev-parse", "HEAD"]);
});
afterEach(async () => {
	await sandbox.cleanup();
});

async function stateOf(shortId: string) {
	const inspected = await branches.inspect(sandbox.repoPath, [
		{ shortId, baseRef: base },
	]);
	return { ...inspected, state: inspected.runs.get(shortId) };
}

describe("inspect", () => {
	test("a fresh worktree: there, clean, merged, not pushed, nothing only here", async () => {
		const worktree = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "abcd1234",
		});
		const { defaultBranch, state } = await stateOf("abcd1234");
		expect(defaultBranch).toBe("main");
		expect(state).toEqual({
			worktreePath: worktree.worktreePath,
			exists: true,
			registered: true,
			changes: 0,
			branches: [
				{
					name: "nightshift/abcd1234",
					merged: true,
					pushed: false,
					ahead: null,
					unsaved: 0,
				},
			],
		});
	});

	test("commits are only here until pushed, then ahead of origin after a new one", async () => {
		const { worktreePath } = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "abcd1234",
		});
		await commitFile(worktreePath, "one.txt");
		let { state } = await stateOf("abcd1234");
		expect(state?.branches[0]).toMatchObject({
			merged: false,
			pushed: false,
			unsaved: 1,
		});

		await mustGit(worktreePath, [
			"push",
			"-q",
			"origin",
			"nightshift/abcd1234",
		]);
		({ state } = await stateOf("abcd1234"));
		expect(state?.branches[0]).toMatchObject({
			merged: false,
			pushed: true,
			ahead: 0,
			unsaved: 0,
		});

		await commitFile(worktreePath, "two.txt");
		({ state } = await stateOf("abcd1234"));
		expect(state?.branches[0]).toMatchObject({ ahead: 1, unsaved: 1 });
	});

	test("work merged into the default branch is merged, also without a push", async () => {
		const { worktreePath } = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "abcd1234",
		});
		await commitFile(worktreePath, "one.txt");
		await mustGit(sandbox.repoPath, [
			"merge",
			"-q",
			"--ff-only",
			"nightshift/abcd1234",
		]);
		const { state } = await stateOf("abcd1234");
		expect(state?.branches[0]).toMatchObject({ merged: true, unsaved: 0 });
	});

	test("counts uncommitted changes, and finds the Item Branches of the run only", async () => {
		const { worktreePath } = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "abcd1234",
		});
		await mustGit(sandbox.repoPath, ["branch", "nightshift/abcd1234-1-login"]);
		await mustGit(sandbox.repoPath, ["branch", "nightshift/ffff0000"]);
		await Bun.write(join(worktreePath, "loose.txt"), "x");
		const { state } = await stateOf("abcd1234");
		expect(state?.changes).toBe(1);
		expect(state?.branches.map((b) => b.name).toSorted()).toEqual([
			"nightshift/abcd1234",
			"nightshift/abcd1234-1-login",
		]);
	});

	test("a run that left nothing", async () => {
		const { state } = await stateOf("00000000");
		expect(state).toMatchObject({
			exists: false,
			registered: false,
			changes: 0,
			branches: [],
		});
	});
});

describe("removal", () => {
	test("git refuses a worktree with changes without force; the branch stays until deleted", async () => {
		const { worktreePath } = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "abcd1234",
		});
		await Bun.write(join(worktreePath, "loose.txt"), "x");
		await expect(
			branches.removeWorktree(sandbox.repoPath, worktreePath),
		).rejects.toThrow();
		expect(existsSync(worktreePath)).toBe(true);

		await branches.removeWorktree(sandbox.repoPath, worktreePath, {
			force: true,
		});
		expect(existsSync(worktreePath)).toBe(false);
		let { state } = await stateOf("abcd1234");
		expect(state).toMatchObject({ exists: false, registered: false });
		expect(state?.branches).toHaveLength(1);

		await branches.deleteBranch(sandbox.repoPath, "nightshift/abcd1234");
		({ state } = await stateOf("abcd1234"));
		expect(state?.branches).toEqual([]);
	});

	test("deleting a local branch leaves the branch on origin", async () => {
		const { worktreePath } = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "abcd1234",
		});
		await commitFile(worktreePath, "one.txt");
		await mustGit(worktreePath, [
			"push",
			"-q",
			"origin",
			"nightshift/abcd1234",
		]);
		await branches.removeWorktree(sandbox.repoPath, worktreePath);
		await branches.deleteBranch(sandbox.repoPath, "nightshift/abcd1234");
		expect(
			await mustGit(join(sandbox.root, "origin.git"), [
				"branch",
				"--list",
				"nightshift/*",
			]),
		).toContain("nightshift/abcd1234");
	});

	test("a worktree whose folder is gone is pruned", async () => {
		const { worktreePath } = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "abcd1234",
		});
		await rm(worktreePath, { recursive: true, force: true });
		let { state } = await stateOf("abcd1234");
		expect(state).toMatchObject({ exists: false, registered: true });
		await branches.prune(sandbox.repoPath);
		({ state } = await stateOf("abcd1234"));
		expect(state?.registered).toBe(false);
	});
});

test("without origin, the default branch is the local main", async () => {
	await mustGit(sandbox.repoPath, ["remote", "remove", "origin"]);
	expect(await branches.defaultBranch(sandbox.repoPath)).toEqual({
		name: "main",
		refs: ["refs/heads/main"],
	});
});
