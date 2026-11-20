import {
	isHiddenFromReaders,
	KNOWLEDGE_INDEX_FILE,
	KNOWLEDGE_STAGING_SUFFIX,
} from "@nightshift/flows";
import { type FolderSnapshot, snapshotFolder } from "../folder-snapshot";

/**
 * Which paths are the knowledge, and which of them a person or an agent
 * reads. A look at a knowledge folder (`scanFolder`) counts these only.
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

/** The knowledge folder `dir` as it is now. No folder there: a snapshot with no files. */
export function scanFolder(dir: string): Promise<FolderSnapshot> {
	return snapshotFolder(dir, {
		counts: isKnowledgePath,
		readable: isReadable,
	});
}
