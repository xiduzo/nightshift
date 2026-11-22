import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fsLearningFolder } from "./fs-learning-folder";
import { inMemoryLearningFolder } from "./in-memory-learning-folder";
import { learningFolderContract } from "./learning-folder.contract";

/** The contract of `LearningFolder`, on both adapters. The real side writes in a new folder per project. */

learningFolderContract("in memory", async () => ({
	folder: inMemoryLearningFolder(),
	close: async () => {},
}));

learningFolderContract("over fs", async () => {
	const dir = await mkdtemp(join(tmpdir(), "nightshift-learning-folder-"));
	return {
		folder: fsLearningFolder({ folder: (projectId) => join(dir, projectId) }),
		close: () => rm(dir, { recursive: true, force: true }),
	};
});
