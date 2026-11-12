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
import { createWorktree, keptRefsOf } from "./worktrees";

const branches = createRunBranches(systemGit());
const identity = [
	"-c",
	"user.name=t",
	"-c",
	"user.email=t@nightshift.invalid",
	"-c",
	"commit.gpgsign=false",
];

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
	return inspected.get(shortId);
}

/** A run's worktree with two commits on its branch. */
async function runWithWork() {
	const worktree = await createWorktree({
		repoPath: sandbox.repoPath,
		shortId: "abcd1234",
	});
	await commitFile(worktree.worktreePath, "one.txt");
	await commitFile(worktree.worktreePath, "two.txt");
	return worktree;
}

describe("inspect", () => {
	test("a fresh worktree: there, clean, on its branch, nothing only here", async () => {
		const worktree = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "abcd1234",
		});
		expect(await stateOf("abcd1234")).toEqual({
			worktreePath: worktree.worktreePath,
			exists: true,
			registered: true,
			changes: 0,
			head: { commit: base, branch: "nightshift/abcd1234", unsaved: 0 },
			branches: [{ name: "nightshift/abcd1234", commit: base, unsaved: 0 }],
		});
	});

	test("commits are only here until pushed", async () => {
		const { worktreePath } = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "abcd1234",
		});
		await commitFile(worktreePath, "one.txt");
		let state = await stateOf("abcd1234");
		expect(state?.branches[0]?.unsaved).toBe(1);
		expect(state?.head?.unsaved).toBe(1);

		await mustGit(worktreePath, [
			"push",
			"-q",
			"origin",
			"nightshift/abcd1234",
		]);
		state = await stateOf("abcd1234");
		expect(state?.branches[0]?.unsaved).toBe(0);

		await commitFile(worktreePath, "two.txt");
		state = await stateOf("abcd1234");
		expect(state?.branches[0]?.unsaved).toBe(1);
	});

	test("work merged into the default branch is saved, also without a push", async () => {
		await runWithWork();
		await mustGit(sandbox.repoPath, [
			"merge",
			"-q",
			"--ff-only",
			"nightshift/abcd1234",
		]);
		expect((await stateOf("abcd1234"))?.branches[0]?.unsaved).toBe(0);
	});

	test("work squash-merged into the default branch is saved", async () => {
		await runWithWork();
		// Someone else's work lands first, as on a busy main.
		await commitFile(sandbox.repoPath, "other.txt");
		await mustGit(sandbox.repoPath, [
			"merge",
			"-q",
			"--squash",
			"nightshift/abcd1234",
		]);
		await mustGit(sandbox.repoPath, [
			...identity,
			"commit",
			"-q",
			"-m",
			"Squashed pull request",
		]);
		await mustGit(sandbox.repoPath, ["push", "-q", "origin", "main"]);
		expect((await stateOf("abcd1234"))?.branches[0]?.unsaved).toBe(0);
	});

	test("work rebase-merged into the default branch is saved", async () => {
		await runWithWork();
		await commitFile(sandbox.repoPath, "other.txt");
		await mustGit(sandbox.repoPath, [
			...identity,
			"cherry-pick",
			"nightshift/abcd1234~1",
			"nightshift/abcd1234",
		]);
		await mustGit(sandbox.repoPath, ["push", "-q", "origin", "main"]);
		expect((await stateOf("abcd1234"))?.branches[0]?.unsaved).toBe(0);
	});

	test("a commit after the squash merge is only here", async () => {
		const { worktreePath } = await runWithWork();
		await mustGit(sandbox.repoPath, [
			"merge",
			"-q",
			"--squash",
			"nightshift/abcd1234",
		]);
		await mustGit(sandbox.repoPath, [...identity, "commit", "-q", "-m", "PR"]);
		await commitFile(worktreePath, "three.txt");
		expect((await stateOf("abcd1234"))?.branches[0]?.unsaved).toBe(3);
	});

	test("counts uncommitted changes, and finds the Item Branches of the run only", async () => {
		const { worktreePath } = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "abcd1234",
		});
		await mustGit(sandbox.repoPath, ["branch", "nightshift/abcd1234-1-login"]);
		await mustGit(sandbox.repoPath, ["branch", "nightshift/ffff0000"]);
		await Bun.write(join(worktreePath, "loose.txt"), "x");
		const state = await stateOf("abcd1234");
		expect(state?.changes).toBe(1);
		expect(state?.branches.map((b) => b.name).toSorted()).toEqual([
			"nightshift/abcd1234",
			"nightshift/abcd1234-1-login",
		]);
	});

	test("a worktree on a branch of its own: its head is that branch, and the run's branch stays a run branch", async () => {
		const { worktreePath } = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "abcd1234",
		});
		await mustGit(worktreePath, ["checkout", "-q", "-b", "tune/1110"]);
		await commitFile(worktreePath, "tune.txt");
		const state = await stateOf("abcd1234");
		expect(state?.head).toMatchObject({ branch: "tune/1110", unsaved: 1 });
		expect(state?.branches).toEqual([
			{ name: "nightshift/abcd1234", commit: base, unsaved: 0 },
		]);
	});

	test("leaves out a run branch another worktree has checked out", async () => {
		await createWorktree({ repoPath: sandbox.repoPath, shortId: "abcd1234" });
		await mustGit(sandbox.repoPath, ["branch", "nightshift/abcd1234-2-mine"]);
		await mustGit(sandbox.repoPath, [
			"checkout",
			"-q",
			"nightshift/abcd1234-2-mine",
		]);
		const state = await stateOf("abcd1234");
		expect(state?.branches.map((b) => b.name)).toEqual(["nightshift/abcd1234"]);
	});

	test("a run that left nothing", async () => {
		expect(await stateOf("00000000")).toMatchObject({
			exists: false,
			registered: false,
			changes: 0,
			head: null,
			branches: [],
		});
	});
});

describe("keeping the work of a run", () => {
	test("commits the changes that are not committed without moving a branch or the index", async () => {
		const { worktreePath } = await createWorktree({
			repoPath: sandbox.repoPath,
			shortId: "abcd1234",
		});
		await commitFile(worktreePath, "one.txt");
		const tip = await mustGit(worktreePath, ["rev-parse", "HEAD"]);
		await Bun.write(join(worktreePath, "loose.txt"), "x");
		await Bun.write(join(worktreePath, "one.txt"), "changed\n");

		const commit = await branches.commitChanges(worktreePath, "kept");
		expect(await mustGit(worktreePath, ["rev-parse", "HEAD"])).toBe(tip);
		expect(await mustGit(worktreePath, ["rev-parse", `${commit}^`])).toBe(tip);
		expect(await mustGit(worktreePath, ["show", `${commit}:loose.txt`])).toBe(
			"x",
		);
		expect(await mustGit(worktreePath, ["show", `${commit}:one.txt`])).toBe(
			"changed",
		);
		// Nothing was staged for the person.
		expect(
			await mustGit(worktreePath, ["diff", "--cached", "--name-only"]),
		).toBe("");
	});

	test("a kept ref is out of sight of git branch, listed by run, and deleted", async () => {
		const { worktreePath } = await runWithWork();
		const tip = await mustGit(worktreePath, ["rev-parse", "HEAD"]);
		const refs = keptRefsOf("abcd1234");
		await branches.keep(sandbox.repoPath, refs.copy, tip);
		await branches.keep(
			sandbox.repoPath,
			refs.branch("nightshift/abcd1234"),
			tip,
		);
		await branches.removeWorktree(sandbox.repoPath, worktreePath);
		await branches.deleteBranch(sandbox.repoPath, "nightshift/abcd1234");

		expect(
			await mustGit(sandbox.repoPath, ["branch", "--list", "nightshift/*"]),
		).toBe("");
		expect(await branches.listKept(sandbox.repoPath)).toEqual(
			new Map([
				[
					"abcd1234",
					[
						"refs/nightshift/kept/abcd1234/copy",
						"refs/nightshift/kept/abcd1234/heads/nightshift/abcd1234",
					],
				],
			]),
		);

		await branches.deleteRef(sandbox.repoPath, refs.copy);
		await branches.deleteRef(
			sandbox.repoPath,
			refs.branch("nightshift/abcd1234"),
		);
		expect(await branches.listKept(sandbox.repoPath)).toEqual(new Map());
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
		let state = await stateOf("abcd1234");
		expect(state).toMatchObject({ exists: false, registered: false });
		expect(state?.branches).toHaveLength(1);

		await branches.deleteBranch(sandbox.repoPath, "nightshift/abcd1234");
		state = await stateOf("abcd1234");
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
		let state = await stateOf("abcd1234");
		expect(state).toMatchObject({ exists: false, registered: true });
		await branches.prune(sandbox.repoPath);
		state = await stateOf("abcd1234");
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
