import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
	commitFile,
	createSandbox,
	mustGit,
	type Sandbox,
} from "../testing/test-support";
import { systemGit } from "./git";
import {
	CHANGE_LIMITS,
	createWorktreeSnapshots,
	splitPatch,
	WorktreeTooLargeError,
} from "./worktree-changes";

let sandbox: Sandbox;
let repo: string;
const { snapshotTree, treeChanges } = createWorktreeSnapshots(systemGit());

beforeEach(async () => {
	sandbox = await createSandbox();
	repo = sandbox.repoPath;
	await commitFile(repo, "a.txt");
	await commitFile(repo, "b.txt");
	await writeFile(join(repo, ".gitignore"), "ignored/\n");
	await mustGit(repo, ["add", ".gitignore"]);
	await mustGit(repo, [
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@nightshift.invalid",
		"commit",
		"-q",
		"-m",
		"ignore",
	]);
});
afterEach(async () => {
	await sandbox.cleanup();
});

const write = (path: string, text: string) =>
	mkdir(join(repo, path, ".."), { recursive: true }).then(() =>
		writeFile(join(repo, path), text),
	);

describe("snapshotTree", () => {
	test("leaves the worktree, its index and its branch as they were", async () => {
		await write("a.txt", "staged\n");
		await mustGit(repo, ["add", "a.txt"]);
		await write("b.txt", "not staged\n");
		await write("new.txt", "new\n");
		const status = await mustGit(repo, ["status", "--porcelain"]);
		const index = await readFile(join(repo, ".git", "index"));
		const head = await mustGit(repo, ["rev-parse", "HEAD"]);

		const tree = await snapshotTree(repo);

		expect(tree).toMatch(/^[0-9a-f]{40,64}$/);
		expect(await mustGit(repo, ["status", "--porcelain"])).toBe(status);
		expect(await readFile(join(repo, ".git", "index"))).toEqual(index);
		expect(await mustGit(repo, ["rev-parse", "HEAD"])).toBe(head);
	});

	test("holds staged, unstaged and new files, not the ignored ones", async () => {
		await write("a.txt", "staged\n");
		await mustGit(repo, ["add", "a.txt"]);
		await write("b.txt", "not staged\n");
		await write("src/new.ts", "new\n");
		await write("ignored/big.bin", "x");

		const tree = await snapshotTree(repo);

		const listed = await mustGit(repo, ["ls-tree", "-r", "--name-only", tree]);
		expect(listed.split("\n")).toEqual([
			".gitignore",
			"README.md",
			"a.txt",
			"b.txt",
			"src/new.ts",
		]);
		expect(await mustGit(repo, ["show", `${tree}:b.txt`])).toBe("not staged");
	});

	test("is the same tree while nothing changes", async () => {
		expect(await snapshotTree(repo)).toBe(await snapshotTree(repo));
	});

	test("refuses a worktree with more new files than the limits take", async () => {
		const small = createWorktreeSnapshots(systemGit(), {
			...CHANGE_LIMITS,
			untrackedFiles: 2,
		});
		await write("one.txt", "1");
		await write("two.txt", "2");
		expect(await small.snapshotTree(repo)).toMatch(/^[0-9a-f]+$/);
		await write("three.txt", "3");
		await expect(small.snapshotTree(repo)).rejects.toBeInstanceOf(
			WorktreeTooLargeError,
		);

		const light = createWorktreeSnapshots(systemGit(), {
			...CHANGE_LIMITS,
			untrackedBytes: 10,
		});
		await write("heavy.txt", "more than ten bytes");
		await expect(light.snapshotTree(repo)).rejects.toBeInstanceOf(
			WorktreeTooLargeError,
		);
	});
});

describe("treeChanges", () => {
	test("is empty between two equal snapshots", async () => {
		const tree = await snapshotTree(repo);
		expect(await treeChanges(repo, tree, tree)).toEqual({ tree, files: [] });
	});

	test("lists what a command did: edits, new files, deletes and renames, with diffs", async () => {
		await write("moved-from.txt", "one\ntwo\nthree\nfour\nfive\n");
		await mustGit(repo, ["add", "moved-from.txt"]);
		const from = await snapshotTree(repo);
		await write("a.txt", "a.txt\nmore\n");
		await rm(join(repo, "b.txt"));
		await write("src/new.ts", "export {};\n");
		await rename(join(repo, "moved-from.txt"), join(repo, "moved-to.txt"));
		const to = await snapshotTree(repo);

		const changes = await treeChanges(repo, from, to);

		expect(changes.tree).toBe(to);
		expect(changes.files).toEqual([
			{
				path: "a.txt",
				status: "modified",
				added: 1,
				removed: 0,
				patch: "@@ -1 +1,2 @@\n a.txt\n+more",
			},
			{
				path: "b.txt",
				status: "deleted",
				added: 0,
				removed: 1,
				patch: "@@ -1 +0,0 @@\n-b.txt",
			},
			{
				path: "moved-to.txt",
				oldPath: "moved-from.txt",
				status: "renamed",
				added: 0,
				removed: 0,
			},
			{
				path: "src/new.ts",
				status: "added",
				added: 1,
				removed: 0,
				patch: "@@ -0,0 +1 @@\n+export {};",
			},
		]);
	});

	test("keeps counts only for a binary file and a lockfile", async () => {
		const from = await snapshotTree(repo);
		await writeFile(join(repo, "logo.png"), Buffer.from([0, 1, 2, 0, 255]));
		await write("bun.lock", "{\n}\n");

		const { files } = await treeChanges(repo, from, await snapshotTree(repo));

		expect(files).toEqual([
			{
				path: "bun.lock",
				status: "added",
				added: 2,
				removed: 0,
				truncated: true,
			},
			{ path: "logo.png", status: "added", added: 0, removed: 0, binary: true },
		]);
	});

	test("cuts a long diff short, and stops at the step's limit", async () => {
		const tight = createWorktreeSnapshots(systemGit(), {
			...CHANGE_LIMITS,
			filePatchBytes: 40,
			stepPatchBytes: 60,
		});
		const from = await tight.snapshotTree(repo);
		await write("a.txt", "a.txt\nline one\nline two\nline three\n");
		await write("b.txt", "b.txt\nshort\n");
		await write("c.txt", "c\n");

		const { files } = await tight.treeChanges(
			repo,
			from,
			await tight.snapshotTree(repo),
		);

		const [a, b, c] = files;
		// Cut at a whole line within 40 bytes.
		expect(a?.patch).toBe("@@ -1 +1,4 @@\n a.txt\n+line one");
		expect(a?.truncated).toBe(true);
		// Whole, and the step has 60 - 30 bytes left.
		expect(b).toMatchObject({ patch: "@@ -1 +1,2 @@\n b.txt\n+short" });
		expect(b?.truncated).toBeUndefined();
		// No room left: counts only.
		expect(c).toEqual({
			path: "c.txt",
			status: "added",
			added: 1,
			removed: 0,
			truncated: true,
		});
	});

	test("marks the files a cut output does not reach", async () => {
		const real = systemGit();
		let cut = false;
		const watched = {
			...real,
			run: async (...args: Parameters<typeof real.run>) => {
				const result = await real.run(...args);
				cut ||= result.cut === true;
				return result;
			},
		};
		const tiny = createWorktreeSnapshots(watched, {
			...CHANGE_LIMITS,
			filePatchBytes: 10,
			stepPatchBytes: 10,
		});
		const from = await tiny.snapshotTree(repo);
		const lines = Array.from({ length: 80 }, (_, n) => `line ${n}`);
		await write("p.txt", `${lines.join("\n")}\n`);
		await write("q.txt", "q\n");

		const { files } = await tiny.treeChanges(
			repo,
			from,
			await tiny.snapshotTree(repo),
		);

		expect(cut).toBe(true);
		expect(
			files.map((file) => [file.path, file.patch, file.truncated]),
		).toEqual([
			["p.txt", undefined, true],
			["q.txt", undefined, true],
		]);
	});

	test("counts the files past the step's limit", async () => {
		const few = createWorktreeSnapshots(systemGit(), {
			...CHANGE_LIMITS,
			files: 2,
		});
		const from = await few.snapshotTree(repo);
		for (const name of ["x.txt", "y.txt", "z.txt"]) await write(name, name);

		const changes = await few.treeChanges(
			repo,
			from,
			await few.snapshotTree(repo),
		);

		expect(changes.files.map((file) => file.path)).toEqual(["x.txt", "y.txt"]);
		expect(changes.omitted).toBe(1);
	});

	test("reads paths with spaces, quotes and other letters", async () => {
		const from = await snapshotTree(repo);
		const names = [
			"with space.txt",
			'say "hi".txt',
			"café.md",
			"tab\there.txt",
		];
		for (const name of names) await write(name, "x\n");

		const { files } = await treeChanges(repo, from, await snapshotTree(repo));

		expect(files.map((file) => [file.path, file.patch])).toEqual(
			[...names]
				.sort((a, b) => (a < b ? -1 : 1))
				.map((name) => [name, "@@ -0,0 +1 @@\n+x"]),
		);
	});
});

describe("splitPatch", () => {
	test("takes each file's hunks by its new path", () => {
		const patch = [
			"diff --git a/a b/a",
			"index 1..2 100644",
			"--- a/a",
			"+++ b/a",
			"@@ -1 +1 @@",
			"-x",
			"+y",
			"diff --git a/old b/new",
			"similarity index 100%",
			"rename from old",
			"rename to new",
		].join("\n");
		expect(splitPatch(patch)).toEqual([
			{ path: "a", hunks: "@@ -1 +1 @@\n-x\n+y" },
			{ path: "new", hunks: null },
		]);
	});
});
