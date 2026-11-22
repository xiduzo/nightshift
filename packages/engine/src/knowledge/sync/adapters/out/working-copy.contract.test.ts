import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fsKnowledgeFolders } from "../../../files/adapters/out/fs-knowledge-folders";
import { fsWorkingCopy } from "./fs-working-copy";
import { inMemoryWorkingCopy } from "./in-memory-working-copy";
import { workingCopyContract } from "./working-copy.contract";

/** The contract of `WorkingCopy`, on both adapters. The real side runs on a new folder. */

workingCopyContract("in memory", async () => ({
	workingCopy: inMemoryWorkingCopy(),
	close: async () => {},
}));

workingCopyContract("over fs", async () => {
	const dataDir = await mkdtemp(join(tmpdir(), "nightshift-copy-"));
	return {
		workingCopy: fsWorkingCopy(fsKnowledgeFolders(dataDir)),
		close: () => rm(dataDir, { recursive: true, force: true }),
	};
});
