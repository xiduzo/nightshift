import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProgram } from "./find-program";

const startPath = process.env.PATH;
let folder: string | null = null;

afterEach(async () => {
	process.env.PATH = startPath;
	if (folder) await rm(folder, { recursive: true, force: true });
	folder = null;
});

describe("findProgram", () => {
	test("finds a program on a PATH set after the process started", async () => {
		folder = await mkdtemp(join(tmpdir(), "nightshift-find-program-"));
		const program = join(folder, "only-here-after-start");
		await writeFile(program, "#!/bin/sh\n");
		await chmod(program, 0o755);

		expect(findProgram("only-here-after-start")).toBeNull();
		process.env.PATH = `${folder}:${startPath}`;
		expect(findProgram("only-here-after-start")).toBe(program);
	});
});
