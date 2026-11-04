/** A folder of the knowledge, with the folders in it. */
export type FolderNode = {
	name: string;
	/** With `/` between its parts. The top of the knowledge has "". */
	path: string;
	/** The files in it and in the folders below it. */
	count: number;
	children: FolderNode[];
};

/** The folder a file is in. "" at the top of the knowledge. */
export function folderOf(path: string): string {
	return path.split("/").slice(0, -1).join("/");
}

/** The name of a file, without its folder. */
export function fileNameOf(path: string): string {
	return path.split("/").pop() ?? path;
}

/** The file is in this folder, or in a folder below it. */
export function isInFolder(path: string, folder: string): boolean {
	return folder === "" || path.startsWith(`${folder}/`);
}

/** The folders of the files, as a tree. Folders come by name, as a list of files does. */
export function folderTree(paths: readonly string[]): FolderNode {
	const root: FolderNode = { name: "", path: "", count: 0, children: [] };
	for (const path of paths) {
		root.count += 1;
		const folder = folderOf(path);
		let at = root;
		for (const part of folder === "" ? [] : folder.split("/")) {
			const inner = at.path === "" ? part : `${at.path}/${part}`;
			let next = at.children.find((child) => child.path === inner);
			if (!next) {
				next = { name: part, path: inner, count: 0, children: [] };
				at.children.push(next);
				at.children.sort((a, b) => a.name.localeCompare(b.name));
			}
			next.count += 1;
			at = next;
		}
	}
	return root;
}

/** A folder and the folders above it, the top first, as a breadcrumb reads. */
export function folderTrail(folder: string): { name: string; path: string }[] {
	if (folder === "") return [];
	const parts = folder.split("/");
	return parts.map((name, index) => ({
		name,
		path: parts.slice(0, index + 1).join("/"),
	}));
}
