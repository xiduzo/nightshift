import type { ProjectFactsReader } from "../../application/ports";
import type { ProjectFacts } from "../../domain/project-facts";

/** `ProjectFactsReader` in memory: the facts of each folder, and the folders that were `read`. */
export function inMemoryProjectFactsReader(
	facts: Readonly<Record<string, ProjectFacts>> = {},
) {
	const read: string[] = [];
	const reader: ProjectFactsReader = async (folder) => {
		read.push(folder);
		return (
			facts[folder] ?? { packageManager: null, scripts: {}, taskFiles: [] }
		);
	};
	return Object.assign(reader, { read });
}
