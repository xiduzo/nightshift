import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	rm,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sha256Of } from "../archive/space-archive";
import { type FileStamp, snapshotFolder } from "./folder-snapshot";

/**
 * One look at a folder: what it counts, what differs from a caller's own
 * record, and a file's hash. Which paths the knowledge counts is in
 * `knowledge/knowledge-paths.test.ts`.
 */

/** Every path counts, and a person or an agent reads each one. */
const every = { counts: () => true, readable: () => true };

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
	test("follows no link, and a folder that is not there has no files", async () => {
		await put("real/a.md", "a");
		await symlink(join(dir, "real"), join(dir, "linked"));
		await symlink(join(dir, "real/a.md"), join(dir, "b.md"));
		expect(paths((await snapshotFolder(dir, every)).files)).toEqual([
			"real/a.md",
		]);
		expect((await snapshotFolder(join(dir, "none"), every)).files).toEqual([]);
	});

	test("keeps the walk's order, the one each `INDEX.md` lists", async () => {
		await put("a-b/x.md", "1");
		await put("a/x.md", "2");
		await put("a.md", "3");
		expect(paths((await snapshotFolder(dir, every)).readable)).toEqual([
			"a/x.md",
			"a-b/x.md",
			"a.md",
		]);
	});
});

describe("what changed since a caller's record", () => {
	test("a new file, one of another size, one of another time, and one that went", async () => {
		const at = 1_600_000_000_000;
		await put("same.md", "same", at);
		await put("size.md", "1234", at);
		await put("time.md", "time", at);
		await put("went.md", "went", at);
		const base = recordOf((await snapshotFolder(dir, every)).files);

		// Another size at the same time is a change too.
		await put("size.md", "12345", at);
		await put("time.md", "time", at + 1000);
		await put("new.md", "new", at);
		await rm(join(dir, "went.md"));

		const { changed, gone } = (await snapshotFolder(dir, every)).changedSince(
			base,
		);
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
		const base = recordOf((await snapshotFolder(dir, every)).files);
		await put("a.md", "after!", at);
		expect(
			(await snapshotFolder(dir, every)).changedSince(base).changed.size,
		).toBe(0);
	});

	test("among fewer files, the rest of the record has gone", async () => {
		await put("a.md", "a");
		await put("b.png", "b");
		const snapshot = await snapshotFolder(dir, every);
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
		const snapshot = await snapshotFolder(dir, every);
		const expected = sha256Of(new TextEncoder().encode("first"));
		expect(await snapshot.sha256("a.md")).toBe(expected);
		await put("a.md", "second");
		expect(await snapshot.sha256("a.md")).toBe(expected);
		// A new look reads it again.
		expect(await (await snapshotFolder(dir, every)).sha256("a.md")).toBe(
			sha256Of(new TextEncoder().encode("second")),
		);
	});

	test("of a file that went is null", async () => {
		await put("a.md", "a");
		const snapshot = await snapshotFolder(dir, every);
		await rm(join(dir, "a.md"));
		expect(await snapshot.sha256("a.md")).toBeNull();
	});
});
