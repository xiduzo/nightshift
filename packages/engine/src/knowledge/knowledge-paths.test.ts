import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	fsKnowledgeFolders as createKnowledgeFolders,
	scanFolder,
} from "./files/adapters/out/fs-knowledge-folders";
import { indexFolder, openView } from "./files/test-support";
import { wireSteps as createStepKnowledge } from "./steps";

/**
 * One look at a knowledge folder: which files count and which are read, and
 * that a step's start takes one look after its reconcile. What a look is
 * (`snapshotFolder`) is in `folder-snapshot/folder-snapshot.test.ts`. The
 * merge's and the search index's use of it are in `reconcile.test.ts` and
 * `search.test.ts`.
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
			files: { writeIndex: indexFolder, openView },
			reader: { read: async () => null },
			learnings: {
				async *keepReported({ events }) {
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
