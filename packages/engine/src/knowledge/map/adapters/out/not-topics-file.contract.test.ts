import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fsNotTopicsFile } from "./fs-not-topics-file";
import { inMemoryNotTopicsFile } from "./in-memory-not-topics-file";
import { notTopicsFileContract } from "./not-topics-file.contract";

/** The contract of `NotTopicsFile`, on both adapters. The real side writes in a new folder per run. */

notTopicsFileContract("in memory", async () => ({
	notTopicsFile: inMemoryNotTopicsFile(),
	close: async () => {},
}));

notTopicsFileContract("over fs", async () => {
	const dir = await mkdtemp(join(tmpdir(), "nightshift-not-topics-"));
	const folder = (projectId: string) => join(dir, projectId);
	return {
		notTopicsFile: fsNotTopicsFile({
			folder,
			async ensure(projectId) {
				await mkdir(folder(projectId), { recursive: true });
				return folder(projectId);
			},
		}),
		close: () => rm(dir, { recursive: true, force: true }),
	};
});
