import {
	isHiddenFromReaders,
	KNOWLEDGE_INDEX_FILE,
	KNOWLEDGE_STAGING_SUFFIX,
} from "@nightshift/flows";

/**
 * Which paths are the knowledge, and which of them a person or an agent
 * reads. A look at a knowledge folder (`KnowledgeFolders.scan`) counts
 * these only.
 */

/** One file of the knowledge, as the index and the Knowledge page list it. */
export type KnowledgeFile = {
	/** Relative to the folder, with `/` between its parts. */
	path: string;
	/** Bytes. */
	size: number;
	/** Epoch ms: the file's time of change. */
	changedAt: number;
	/** Larger than 10 MB: it stays on the Device that has it. */
	local?: true;
};

/** The longest path the knowledge takes. */
const MAX_PATH = 1024;

/**
 * Whether a path is one of the knowledge, in the folder and in the
 * Space's document: relative, with `/` between its parts, none of them
 * empty, `.`, `..` or hidden, none a file or folder a sync kit still
 * writes (`*.part`), and not the index Night Shift writes. A path another
 * Device wrote that is not one is left out: it never leaves the folder.
 */
export function isKnowledgePath(path: string): boolean {
	if (path === "" || path.length > MAX_PATH) return false;
	// Not even in another case: on macOS, `index.md` is the index.
	if (path.toLowerCase() === KNOWLEDGE_INDEX_FILE.toLowerCase()) return false;
	if (/[\\\0]/.test(path)) return false;
	return path
		.split("/")
		.every(
			(part) =>
				part !== "" &&
				!part.startsWith(".") &&
				!part.endsWith(KNOWLEDGE_STAGING_SUFFIX),
		);
}

/**
 * Whether a person or an agent reads a path: one of the knowledge, but no
 * proposed learning and nothing of the question set. The index, search and
 * `read_knowledge` take these only.
 */
export function isReadable(path: string): boolean {
	return isKnowledgePath(path) && !isHiddenFromReaders(path);
}

/** Whether a path of the knowledge is in one of the folders, or is one of them (a file can be listed too). `books` holds `books/a.md`, not `bookshelf/a.md`. */
export function inFolders(path: string, folders: readonly string[]): boolean {
	return folders.some(
		(folder) => path === folder || path.startsWith(`${folder}/`),
	);
}

/**
 * A path as a person or an agent gave it (`./` in front, spaces around),
 * or null when it is not one they read (`isReadable`).
 */
export function cleanPath(path: string): string | null {
	const clean = path.trim().replace(/^\.\/+/, "");
	return isReadable(clean) ? clean : null;
}
