import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderIndexContract } from "./folder-index.contract";
import { fsFolderIndex } from "./fs-folder-index";
import { inMemoryFolderIndex } from "./in-memory-folder-index";

/** The contract of `FolderIndex`, on both adapters. The real side runs on a new folder. */

folderIndexContract("in memory", async () => {
	const index = inMemoryFolderIndex();
	return {
		folderIndex: index,
		dir: "/knowledge/p1",
		put: async (path, text) => index.putFile("/knowledge/p1", path, text),
		close: async () => {},
	};
});

folderIndexContract("over fs", async () => {
	const dir = await mkdtemp(join(tmpdir(), "nightshift-index-"));
	return {
		folderIndex: fsFolderIndex(),
		dir,
		put: (path, text) => writeFile(join(dir, path), text),
		close: () => rm(dir, { recursive: true, force: true }),
	};
});
