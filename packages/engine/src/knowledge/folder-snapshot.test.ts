import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sha256Of } from "../archive";
import { createKnowledgeFolders, indexFolder } from "./folder";
import { type FileStamp, scanFolder } from "./folder-snapshot";
import { createStepKnowledge } from "./step-knowledge";

/**
 * One look at a knowledge folder: which files count, what differs from a
 * caller's own record, and that a step's start takes one look after its
 * reconcile. The merge's and the search index's use of it are in
 * `reconcile.test.ts` and `search.test.ts`.
 */

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-snapshot-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const put = async (path: string, text: string, at?: number) => {
	await mkdir(dirname(join(dir, path)), { recursive: true });
	await writeFile(join(dir, path), text);
	if (at !== undefined) await utimes(join(dir, path), at / 1000, at / 1000);
};
const paths = (files: readonly { path: string }[]) => files.map((f) => f.path);

/** A caller's record of the files as the snapshot has them now. */
const recordOf = (
	files: readonly { path: string; size: number; changedAt: number }[],
) =>
	new Map<string, FileStamp & { path: string }>(
		files.map((f) => [
			f.path,
			{ path: f.path, size: f.size, mtimeMs: f.changedAt },
		]),
	);

describe("a scan", () => {
	test("sees what syncs in `files`, and what is read in `readable`", async () => {
		await put("wiki/Home.md", "# Home\n");
		await put("learnings/proposed/r1.md", "- waits");
		await put("learnings/accepted/r0.md", "- kept");
		await put("evals/questions.md", "q");
		await put("INDEX.md", "the index");
		await put(".reconciled.json", "{}");
		await put("web/page.md.part", "half");
		const snapshot = await scanFolder(dir);
		expect(paths(snapshot.files)).toEqual([
			"evals/questions.md",
			"learnings/accepted/r0.md",
			"learnings/proposed/r1.md",
			"wiki/Home.md",
		]);
		expect(paths(snapshot.readable)).toEqual([
			"learnings/accepted/r0.md",
			"wiki/Home.md",
		]);
		expect(snapshot.file("wiki/Home.md")?.size).toBe(7);
		expect(snapshot.file("INDEX.md")).toBeUndefined();
	});

	test("follows no link, and a folder that is not there has no files", async () => {
		await put("real/a.md", "a");
		await symlink(join(dir, "real"), join(dir, "linked"));
		await symlink(join(dir, "real/a.md"), join(dir, "b.md"));
		expect(paths((await scanFolder(dir)).files)).toEqual(["real/a.md"]);
		expect((await scanFolder(join(dir, "none"))).files).toEqual([]);
	});

	test("keeps the walk's order, the one each `INDEX.md` lists", async () => {
		await put("a-b/x.md", "1");
		await put("a/x.md", "2");
		await put("a.md", "3");
		expect(paths((await scanFolder(dir)).readable)).toEqual([
			"a/x.md",
			"a-b/x.md",
			"a.md",
		]);
	});

	test("the newest change counts a file that went from its folder, not what no reader sees", async () => {
		const old = 1_600_000_000_000;
		await put("wiki/a.md", "a", old);
		await put("wiki/b.md", "b", old);
		await utimes(join(dir, "wiki"), old / 1000, old / 1000);
		expect((await scanFolder(dir)).newestReadable).toBe(old);

		// What waits for a person changes nothing a reader sees.
		await put("learnings/proposed/r1.md", "- waits");
		await utimes(join(dir, "learnings"), old / 1000, old / 1000);
		expect((await scanFolder(dir)).newestReadable).toBe(old);

		await rm(join(dir, "wiki/b.md"));
		expect((await scanFolder(dir)).newestReadable).toBeGreaterThan(old);
	});
});

describe("what changed since a caller's record", () => {
	test("a new file, one of another size, one of another time, and one that went", async () => {
		const at = 1_600_000_000_000;
		await put("same.md", "same", at);
		await put("size.md", "1234", at);
		await put("time.md", "time", at);
		await put("went.md", "went", at);
		const base = recordOf((await scanFolder(dir)).files);

		// Another size at the same time is a change too.
		await put("size.md", "12345", at);
		await put("time.md", "time", at + 1000);
		await put("new.md", "new", at);
		await rm(join(dir, "went.md"));

		const { changed, gone } = (await scanFolder(dir)).changedSince(base);
		expect([...changed.keys()].sort()).toEqual([
			"new.md",
			"size.md",
			"time.md",
		]);
		expect(paths(gone)).toEqual(["went.md"]);
	});

	test("an edit that keeps both size and time is not seen: no weaker, and no stronger", async () => {
		const at = 1_600_000_000_000;
		await put("a.md", "before", at);
		const base = recordOf((await scanFolder(dir)).files);
		await put("a.md", "after!", at);
		expect((await scanFolder(dir)).changedSince(base).changed.size).toBe(0);
	});

	test("among fewer files, the rest of the record has gone", async () => {
		await put("a.md", "a");
		await put("b.png", "b");
		const snapshot = await scanFolder(dir);
		const base = recordOf(snapshot.files);
		const { changed, gone } = snapshot.changedSince(
			base,
			snapshot.files.filter((f) => f.path === "a.md"),
		);
		expect(changed.size).toBe(0);
		expect(paths(gone)).toEqual(["b.png"]);
	});
});

describe("a file's hash", () => {
	test("is read at the first question, and once per snapshot", async () => {
		await put("a.md", "first");
		const snapshot = await scanFolder(dir);
		const expected = sha256Of(new TextEncoder().encode("first"));
		expect(await snapshot.sha256("a.md")).toBe(expected);
		await put("a.md", "second");
		expect(await snapshot.sha256("a.md")).toBe(expected);
		// A new look reads it again.
		expect(await (await scanFolder(dir)).sha256("a.md")).toBe(
			sha256Of(new TextEncoder().encode("second")),
		);
	});

	test("of a file that went is null", async () => {
		await put("a.md", "a");
		const snapshot = await scanFolder(dir);
		await rm(join(dir, "a.md"));
		expect(await snapshot.sha256("a.md")).toBeNull();
	});
});

describe("a step's start", () => {
	test("takes one look after its reconcile, for the index and for the search", async () => {
		const folders = createKnowledgeFolders(dir);
		const folder = await folders.ensure("p1");
		const order: string[] = [];
		const refreshed: unknown[] = [];
		const steps = createStepKnowledge({
			folders: {
				...folders,
				scan: async (projectId) => {
					order.push("scan");
					return folders.scan(projectId);
				},
			},
			reconciler: {
				startStep: async () => {
					order.push("reconcile");
					// The reconcile brings a file of another Device in.
					await writeFile(join(folder, "from-the-space.md"), "# In step\n");
					return { done: async () => {} };
				},
			},
			reader: { read: async () => null },
			learnings: {
				async *keepReported(events) {
					yield* events;
				},
			},
			search: {
				search: async () => [],
				refresh: async (_projectId, snapshot) => {
					refreshed.push(snapshot);
					return { files: 0, indexed: 0, removed: 0 };
				},
			},
		});

		await steps.forSession({ knowledge: { projectId: "p1" } });

		expect(order).toEqual(["reconcile", "scan"]);
		expect(refreshed).toHaveLength(1);
		expect(await readFile(join(folder, "INDEX.md"), "utf8")).toContain(
			"`from-the-space.md`: In step",
		);
	});
});

describe("the index of a look at a folder", () => {
	test("written from a look that is not there yet makes the folder", async () => {
		const snapshot = await scanFolder(join(dir, "new"));
		await indexFolder(snapshot);
		expect(await readFile(join(dir, "new", "INDEX.md"), "utf8")).toContain(
			"No files yet.",
		);
	});
});
