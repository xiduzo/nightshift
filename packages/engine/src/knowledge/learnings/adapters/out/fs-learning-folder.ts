import { appendFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeWhole } from "../../../../archive";
import type { LearningFolder } from "../../application/ports";

/**
 * The files of `learnings/` in each project's knowledge folder on this
 * computer, over `node:fs`. A path of the port is a path in the folder,
 * with `/` between its parts.
 */
export function fsLearningFolder(folders: {
	folder(projectId: string): string;
}): LearningFolder {
	const fileOf = (projectId: string, path: string) =>
		join(folders.folder(projectId), ...path.split("/"));
	return {
		async has(projectId, path) {
			return (await stat(fileOf(projectId, path)).catch(() => null)) !== null;
		},
		bytes: (projectId, path) =>
			readFile(fileOf(projectId, path)).catch(() => null),
		text: (projectId, path) =>
			readFile(fileOf(projectId, path), "utf8").catch(() => null),
		async append(projectId, path, data) {
			const file = fileOf(projectId, path);
			await mkdir(dirname(file), { recursive: true });
			await appendFile(file, data);
		},
		write: (projectId, path, text) => writeWhole(fileOf(projectId, path), text),
		remove: (projectId, path) => rm(fileOf(projectId, path), { force: true }),
	};
}
