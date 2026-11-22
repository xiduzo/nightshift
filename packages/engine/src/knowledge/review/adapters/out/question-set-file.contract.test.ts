import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fsQuestionSetFile } from "./fs-question-set-file";
import { inMemoryQuestionSetFile } from "./in-memory-question-set-file";
import { questionSetFileContract } from "./question-set-file.contract";

/** The contract of `QuestionSetFile`, on both adapters. The real side writes in a new folder per run. */

questionSetFileContract("in memory", async () => ({
	questionSetFile: inMemoryQuestionSetFile(),
	close: async () => {},
}));

questionSetFileContract("over fs", async () => {
	const dir = await mkdtemp(join(tmpdir(), "nightshift-question-set-"));
	const folder = (projectId: string) => join(dir, projectId);
	return {
		questionSetFile: fsQuestionSetFile({
			folder,
			async ensure(projectId) {
				await mkdir(folder(projectId), { recursive: true });
				return folder(projectId);
			},
		}),
		close: () => rm(dir, { recursive: true, force: true }),
	};
});
