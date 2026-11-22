import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NOT_TOPICS_FILE } from "@nightshift/flows";
import { writeWhole } from "../../../../archive";
import type { NotTopicsFile } from "../../application/ports";

/**
 * `NotTopicsFile` over the knowledge folders on this computer: the file
 * `evals/not-topics.json` of each project's folder. A file that cannot be
 * read counts as none. `wireMap` builds it.
 */
export function fsNotTopicsFile(folders: {
	folder(projectId: string): string;
	/** The folder, made when it is not there yet. */
	ensure(projectId: string): Promise<string>;
}): NotTopicsFile {
	/** The file of the words that are not topics, in this computer's folder. */
	const fileOf = (projectId: string) =>
		join(folders.folder(projectId), ...NOT_TOPICS_FILE.split("/"));
	return {
		read: (projectId) => readFile(fileOf(projectId), "utf8").catch(() => null),
		async write(projectId, text) {
			await folders.ensure(projectId);
			await writeWhole(fileOf(projectId), text);
		},
	};
}
