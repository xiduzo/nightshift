import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileTextsContract } from "./file-texts.contract";
import { fsFileTexts } from "./fs-file-texts";
import { inMemoryFileTexts } from "./in-memory-file-texts";

/** The contract of `FileTexts`, on both adapters. The real side reads a new folder. */

fileTextsContract("in memory", async () => {
	const fileTexts = inMemoryFileTexts();
	const dir = "/knowledge/p1";
	return {
		fileTexts,
		dir,
		put: async (path, text) => fileTexts.put(dir, path, text),
		close: async () => {},
	};
});

fileTextsContract("over fs", async () => {
	const dir = await mkdtemp(join(tmpdir(), "nightshift-file-texts-"));
	return {
		fileTexts: fsFileTexts(),
		dir,
		put: async (path, text) => {
			const abs = join(dir, ...path.split("/"));
			await mkdir(dirname(abs), { recursive: true });
			await writeFile(abs, text);
		},
		close: () => rm(dir, { recursive: true, force: true }),
	};
});
