import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { QUESTION_SET_FILE } from "@nightshift/flows";
import { writeWhole } from "../../../../archive";
import type { QuestionSetFile } from "../../application/ports";

/**
 * `QuestionSetFile` over the knowledge folders on this computer: the file
 * `evals/questions.json` of each project's folder. A file that cannot be
 * read counts as none. `wireReview` builds it.
 */
export function fsQuestionSetFile(folders: {
	folder(projectId: string): string;
	/** The folder, made when it is not there yet. */
	ensure(projectId: string): Promise<string>;
}): QuestionSetFile {
	const parts = QUESTION_SET_FILE.split("/");
	return {
		read: (projectId) =>
			readFile(join(folders.folder(projectId), ...parts), "utf8").catch(
				() => null,
			),
		async write(projectId, text) {
			await writeWhole(join(await folders.ensure(projectId), ...parts), text);
		},
	};
}
