/** Folders Night Shift keeps for itself: no agent reads them. */
const OWN_FOLDERS = ["learnings/proposed", "evals"];

/**
 * The folders of the knowledge an Agent node may pick, from the paths of
 * its files: every folder that holds a file, at any depth, sorted. Not the
 * ones no agent reads.
 */
export function foldersOf(paths: readonly string[]): string[] {
	const folders = new Set<string>();
	for (const path of paths) {
		const parts = path.split("/").slice(0, -1);
		for (let i = 1; i <= parts.length; i++) {
			folders.add(parts.slice(0, i).join("/"));
		}
	}
	return [...folders]
		.filter(
			(folder) =>
				!OWN_FOLDERS.some(
					(own) => folder === own || folder.startsWith(`${own}/`),
				),
		)
		.sort();
}
