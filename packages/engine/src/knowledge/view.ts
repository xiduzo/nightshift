import { copyFile, mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { indexFolder, type KnowledgeFile } from "./folder";

/**
 * A view of a project's knowledge: what an Agent step gets when its node
 * lists folders of it (`knowledge: ["books", "learnings/accepted"]`). An
 * agent that sees a result steers toward it, so it gets those folders
 * only:
 *
 * - a copy of their files in a folder of its own, outside the knowledge
 *   folder and outside every worktree, so no reconcile ever sees it and
 *   nothing the agent writes there reaches the knowledge or the Space;
 * - an `INDEX.md` of its own, over those files only;
 * - `NS_KNOWLEDGE`, the line and the folder to read point at the copy;
 * - its search and reads find nothing outside the folders (`inFolders`).
 *
 * The copy goes when the step ends.
 */

/**
 * Whether a path of the knowledge is in one of the folders, or is one of
 * them (a file can be listed too). `books` holds `books/a.md`, not
 * `bookshelf/a.md`.
 */
export function inFolders(path: string, folders: readonly string[]): boolean {
	return folders.some(
		(folder) => path === folder || path.startsWith(`${folder}/`),
	);
}

/** A step's copy of some folders of the knowledge. */
export type KnowledgeView = {
	/** The copy's folder. */
	path: string;
	/** The files in it, as its index lists them. */
	files: KnowledgeFile[];
	/** Removes the copy. Twice is fine. */
	remove(): Promise<void>;
};

/**
 * Copies the files of the knowledge folder `source` that are in `folders`
 * into a new folder of their own, and writes its index. `files`: the files
 * of `source` a person or an agent reads. Each file keeps the time it last
 * changed, which the index shows. Nothing is linked: a write to the copy
 * never reaches `source`.
 */
export async function createKnowledgeView(
	source: string,
	files: readonly KnowledgeFile[],
	folders: readonly string[],
): Promise<KnowledgeView> {
	const path = await mkdtemp(join(tmpdir(), "nightshift-knowledge-"));
	const remove = () => rm(path, { recursive: true, force: true });
	try {
		for (const file of files) {
			if (!inFolders(file.path, folders)) continue;
			const parts = file.path.split("/");
			const to = join(path, ...parts);
			await mkdir(dirname(to), { recursive: true });
			// A file that went since the walk is left out.
			const copied = await copyFile(join(source, ...parts), to).then(
				() => true,
				() => false,
			);
			if (!copied) continue;
			// In seconds.
			const at = file.changedAt / 1000;
			await utimes(to, at, at);
		}
		return { path, files: await indexFolder(path), remove };
	} catch (error) {
		await remove();
		throw error;
	}
}
