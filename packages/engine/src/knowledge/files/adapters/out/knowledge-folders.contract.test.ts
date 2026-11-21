import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fsKnowledgeFolders } from "./fs-knowledge-folders";
import { inMemoryKnowledgeFolders } from "./in-memory-knowledge-folders";
import { knowledgeFoldersContract } from "./knowledge-folders.contract";

/** The contract of `KnowledgeFolders`, on both adapters. The real side runs on a new folder. */

knowledgeFoldersContract("in memory", async () => {
	const folders = inMemoryKnowledgeFolders();
	return {
		knowledgeFolders: folders,
		put: async (projectId, path, text) => folders.put(projectId, path, text),
		close: async () => {},
	};
});

knowledgeFoldersContract("over fs", async () => {
	const dataDir = await mkdtemp(join(tmpdir(), "nightshift-folders-"));
	const folders = fsKnowledgeFolders(dataDir);
	return {
		knowledgeFolders: folders,
		async put(projectId, path, text) {
			const file = join(folders.folder(projectId), ...path.split("/"));
			await mkdir(dirname(file), { recursive: true });
			await writeFile(file, text);
		},
		close: () => rm(dataDir, { recursive: true, force: true }),
	};
});
