import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunFolders, NOT_A_RUN_FILE, RUN_FILES_MAX } from "./run-folders";

let dataDir: string;
beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "nightshift-run-folders-"));
});
afterEach(async () => {
	await rm(dataDir, { recursive: true, force: true });
});

describe("run folders", () => {
	test("each run has its own folder in the data folder", () => {
		const folders = createRunFolders(dataDir);
		expect(folders.path("run-1")).toBe(join(dataDir, "run-folders", "run-1"));
	});

	test("make makes the folder once, and says when it was not there", async () => {
		const folders = createRunFolders(dataDir);
		const first = await folders.make("run-1");
		expect(first).toEqual({ path: folders.path("run-1"), made: true });
		expect(existsSync(first.path)).toBe(true);
		await writeFile(join(first.path, "notes.md"), "kept\n");
		// Again: the folder and its files stay.
		expect(await folders.make("run-1")).toEqual({
			path: first.path,
			made: false,
		});
		expect(existsSync(join(first.path, "notes.md"))).toBe(true);
	});

	test("a folder that is gone is made again, empty", async () => {
		const folders = createRunFolders(dataDir);
		const { path } = await folders.make("run-1");
		await writeFile(join(path, "notes.md"), "lost\n");
		await rm(path, { recursive: true });
		expect((await folders.make("run-1")).made).toBe(true);
		expect(existsSync(join(path, "notes.md"))).toBe(false);
	});

	test("remove takes the folder and its files, also when it is gone", async () => {
		const folders = createRunFolders(dataDir);
		const { path } = await folders.make("run-1");
		await writeFile(join(path, "notes.md"), "x\n");
		await folders.remove("run-1");
		expect(existsSync(path)).toBe(false);
		await folders.remove("run-1");
	});

	test("refuses an id that would leave the folder", () => {
		const folders = createRunFolders(dataDir);
		for (const id of ["", "..", "../x", "a/b", ".hidden"]) {
			expect(() => folders.path(id)).toThrow("That is not the id of a run.");
		}
	});
});

describe("the files of a run folder", () => {
	/** A run folder with `notes.md`, `report/summary.md` and a `.git` folder. */
	async function withFiles() {
		const folders = createRunFolders(dataDir);
		const { path } = await folders.make("run-1");
		await writeFile(join(path, "notes.md"), "notes\n");
		await mkdir(join(path, "report"));
		await writeFile(join(path, "report", "summary.md"), "summary\n");
		await mkdir(join(path, ".git"));
		await writeFile(join(path, ".git", "HEAD"), "ref: main\n");
		return { folders, path };
	}

	test("lists every file by its path in the folder, without .git", async () => {
		const { folders } = await withFiles();
		const listed = await folders.list("run-1");
		expect(listed?.more).toBe(false);
		expect(listed?.files.map(({ path, size }) => [path, size])).toEqual([
			["notes.md", 6],
			["report/summary.md", 8],
		]);
		expect(listed?.files[0]?.modifiedAt).toBeGreaterThan(0);
		expect(await folders.list("run-2")).toBeNull();
	});

	test("stops at the most entries it walks, and says so", async () => {
		const folders = createRunFolders(dataDir);
		const { path } = await folders.make("run-1");
		await Promise.all(
			Array.from({ length: RUN_FILES_MAX + 5 }, (_, i) =>
				writeFile(join(path, `f${String(i).padStart(4, "0")}.txt`), ""),
			),
		);
		const listed = await folders.list("run-1");
		expect(listed?.more).toBe(true);
		expect(listed?.files).toHaveLength(RUN_FILES_MAX);
		expect(listed?.files[0]?.path).toBe("f0000.txt");
	});

	test("gives a file of the folder and where it is", async () => {
		const { folders, path } = await withFiles();
		const found = await folders.file("run-1", "report/summary.md");
		expect(found?.file).toMatchObject({ path: "report/summary.md", size: 8 });
		expect(await Bun.file(found?.path ?? "").text()).toBe("summary\n");
		expect(found?.path).toBe(
			join(await realpath(path), "report", "summary.md"),
		);
		// A folder, or a file that is not there: none.
		expect(await folders.file("run-1", "report")).toBeNull();
		expect(await folders.file("run-1", "gone.md")).toBeNull();
		expect(await folders.file("run-2", "notes.md")).toBeNull();
	});

	test("refuses a path that leaves the folder or goes into .git", async () => {
		const { folders } = await withFiles();
		await writeFile(join(dataDir, "secret.txt"), "secret\n");
		for (const path of [
			"../../secret.txt",
			"report/../../../secret.txt",
			"/etc/hosts",
			"",
			"report/",
			"./notes.md",
			".git/HEAD",
			"notes.md\0",
		]) {
			await expect(folders.file("run-1", path)).rejects.toThrow(NOT_A_RUN_FILE);
		}
	});

	test("never follows a link: it is not listed and not served", async () => {
		const { folders, path } = await withFiles();
		const outside = join(dataDir, "outside");
		await mkdir(outside);
		await writeFile(join(outside, "secret.txt"), "secret\n");
		await symlink(join(outside, "secret.txt"), join(path, "secret.txt"));
		await symlink(outside, join(path, "elsewhere"));
		// A link inside the folder to a file of the folder is refused too.
		await symlink(join(path, "notes.md"), join(path, "again.md"));

		const listed = await folders.list("run-1");
		expect(listed?.files.map((f) => f.path)).toEqual([
			"notes.md",
			"report/summary.md",
		]);
		expect(await folders.file("run-1", "secret.txt")).toBeNull();
		expect(await folders.file("run-1", "elsewhere/secret.txt")).toBeNull();
		expect(await folders.file("run-1", "again.md")).toBeNull();
	});

	test("a run folder that is a link is not one: no list, no file", async () => {
		const folders = createRunFolders(dataDir);
		const outside = join(dataDir, "outside");
		await mkdir(outside);
		await writeFile(join(outside, "secret.txt"), "secret\n");
		await mkdir(join(dataDir, "run-folders"));
		await symlink(outside, folders.path("run-1"));
		expect(await folders.list("run-1")).toBeNull();
		expect(await folders.file("run-1", "secret.txt")).toBeNull();
		expect(await folders.runIds()).toEqual([]);
	});

	test("knows the runs with a folder here, and when each last changed", async () => {
		const folders = createRunFolders(dataDir);
		expect(await folders.runIds()).toEqual([]);
		const { path } = await folders.make("run-1");
		await folders.make("run-2");
		await writeFile(join(dataDir, "run-folders", "stray.txt"), "");
		await mkdir(join(dataDir, "run-folders", ".hidden"));
		expect(await folders.runIds()).toEqual(["run-1", "run-2"]);

		await mkdir(join(path, "deep"));
		await writeFile(join(path, "deep", "late.txt"), "");
		// 1 January 2030.
		const late = 1_893_456_000_000;
		await utimes(join(path, "deep", "late.txt"), late / 1000, late / 1000);
		expect(await folders.lastChange("run-1")).toBe(late);
		expect(await folders.lastChange("run-3")).toBeNull();
	});
});
