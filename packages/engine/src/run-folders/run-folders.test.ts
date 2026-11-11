import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunFolders } from "./run-folders";

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
