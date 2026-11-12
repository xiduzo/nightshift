import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFolderFile } from "./read-file";

/** One text file the run wrote, read on this computer: only inside the folder, never through a link. */

let root: string;
let folder: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "nightshift-read-file-"));
	folder = join(root, "run");
	await mkdir(join(folder, "out"), { recursive: true });
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const read = (path: string, maxBytes = 1024) =>
	readFolderFile({ cwd: folder, path, maxBytes });

describe("readFolderFile", () => {
	test("reads a text file of the folder as UTF-8", async () => {
		await writeFile(join(folder, "out", "news.md"), "﻿## Nieuws é 😀\n");
		expect(await read("out/news.md")).toEqual({
			kind: "text",
			text: "## Nieuws é 😀\n",
			cut: false,
		});
	});

	test("a path with no file, or with a folder, is missing", async () => {
		expect(await read("none.md")).toEqual({ kind: "missing" });
		expect(await read("out")).toEqual({ kind: "missing" });
		expect(await read("none/report.md")).toEqual({ kind: "missing" });
	});

	test("a path that leaves the folder or goes into .git is outside", async () => {
		await writeFile(join(root, "secret.md"), "not the run's");
		await mkdir(join(folder, ".git"));
		await writeFile(join(folder, ".git", "config"), "[core]");
		for (const path of [
			"../secret.md",
			"out/../../secret.md",
			".git/config",
			"out//news.md",
			"./news.md",
			"",
			"a\0b",
		]) {
			expect(await read(path)).toEqual({ kind: "outside" });
		}
	});

	test("a link is outside: to a file out of the folder, in it, or a folder on the way", async () => {
		await writeFile(join(root, "secret.md"), "not the run's");
		await writeFile(join(folder, "real.md"), "the run's");
		await symlink(join(root, "secret.md"), join(folder, "escape.md"));
		await symlink(join(folder, "real.md"), join(folder, "inside.md"));
		await symlink(root, join(folder, "up"));
		await symlink(join(root, "gone.md"), join(folder, "dangling.md"));
		for (const path of [
			"escape.md",
			"inside.md",
			"up/secret.md",
			"dangling.md",
		]) {
			expect(await read(path)).toEqual({ kind: "outside" });
		}
		expect(await read("real.md")).toMatchObject({ kind: "text" });
	});

	test("a folder that is reached through a link of its own still reads", async () => {
		await writeFile(join(folder, "report.md"), "# Done");
		const alias = join(root, "alias");
		await symlink(folder, alias);
		expect(
			await readFolderFile({ cwd: alias, path: "report.md", maxBytes: 64 }),
		).toEqual({ kind: "text", text: "# Done", cut: false });
	});

	test("a file that is not UTF-8, or holds a NUL, is not text", async () => {
		await writeFile(
			join(folder, "chart.png"),
			new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		);
		await writeFile(join(folder, "nul.txt"), "a\0b");
		await writeFile(join(folder, "latin1.txt"), new Uint8Array([0x63, 0xe9]));
		for (const path of ["chart.png", "nul.txt", "latin1.txt"]) {
			expect(await read(path)).toEqual({ kind: "not-text" });
		}
	});

	test("a longer file is cut at the last line break within the cap", async () => {
		await writeFile(join(folder, "long.md"), "one\ntwo\nthree\nfour\n");
		expect(await read("long.md", 10)).toEqual({
			kind: "text",
			text: "one\ntwo",
			cut: true,
		});
		// A line break right after the cap still ends a whole line.
		await writeFile(join(folder, "edge.md"), "one\ntwo\nmore");
		expect(await read("edge.md", 7)).toEqual({
			kind: "text",
			text: "one\ntwo",
			cut: true,
		});
		expect(await read("edge.md", 12)).toEqual({
			kind: "text",
			text: "one\ntwo\nmore",
			cut: false,
		});
	});

	test("one long line is cut before the character the cap falls in", async () => {
		// "é" is 2 bytes: a cap of 4 falls inside the second one.
		await writeFile(join(folder, "line.md"), "aéééé");
		expect(await read("line.md", 4)).toEqual({
			kind: "text",
			text: "aé",
			cut: true,
		});
	});
});
