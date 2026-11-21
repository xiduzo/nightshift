import type { KnowledgeFile } from "../domain/paths";
import { inFolders } from "../domain/paths";
import type { ViewCopies } from "./ports";
import type { WriteKnowledgeIndex } from "./write-knowledge-index";

export type OpenKnowledgeViewPorts = {
	views: ViewCopies;
	/** The index of a folder, written again when it is stale (`writeKnowledgeIndex`, bound). */
	writeIndex(request: WriteKnowledgeIndex): Promise<void>;
};

/** Which folders of which knowledge folder the view holds. */
export type OpenKnowledgeView = {
	/** The knowledge folder. */
	source: string;
	/** The files of `source` a person or an agent reads. */
	files: readonly KnowledgeFile[];
	/** The folders of the knowledge the view holds (`knowledge: ["books"]` of a node). */
	folders: readonly string[];
};

/** A step's copy of some folders of the knowledge. */
export type KnowledgeView = {
	/** The copy's folder. */
	path: string;
	/** Removes the copy. Twice is fine. */
	remove(): Promise<void>;
};

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
 * The copy goes when the step ends. Each file keeps the time it last
 * changed, which the index shows. Nothing is linked: a write to the copy
 * never reaches `source`. A step of Night Shift asks it.
 */
export const openKnowledgeView =
	(ports: OpenKnowledgeViewPorts) =>
	async (request: OpenKnowledgeView): Promise<KnowledgeView> => {
		const path = await ports.views.make();
		const remove = () => ports.views.remove(path);
		try {
			for (const file of request.files) {
				if (!inFolders(file.path, request.folders)) continue;
				// A file that went since the walk is left out.
				await ports.views.copy(request.source, path, file);
			}
			await ports.writeIndex({ snapshot: await ports.views.scan(path) });
			return { path, remove };
		} catch (error) {
			await remove();
			throw error;
		}
	};
