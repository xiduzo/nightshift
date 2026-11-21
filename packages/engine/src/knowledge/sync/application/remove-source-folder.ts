import { isKnowledgePath } from "../../files";
import type { KnowledgeFolderLocks } from "../domain/folder-locks";
import { folderPrefix, heldNow } from "../domain/removal";
import type { KnowledgeDocuments, WorkingCopy } from "./ports";

export type RemoveSourceFolderPorts = {
	copy: Pick<WorkingCopy, "folder">;
	locks: Pick<KnowledgeFolderLocks, "held">;
	documents: Pick<KnowledgeDocuments, "open">;
	/** The reconcile of a folder (`reconcileFolder`, bound). */
	reconcile(projectId: string): Promise<void>;
};

/** Which folder of which project's knowledge to remove. */
export type RemoveSourceFolder = { projectId: string; folder: string };

/**
 * Removes a folder of the project's knowledge, for every Device of the
 * Space: its entries leave the document (after a reconcile, so this
 * Device's own changes are in it first), and the next reconcile of each
 * Device removes the files from its folder. Removes the folder's files
 * here at once. Returns how many files it removed. Refuses a folder
 * outside the knowledge, and while a run changes it. A person removes a
 * source with its files. The API checks who may first.
 */
export const removeSourceFolder =
	(ports: RemoveSourceFolderPorts) =>
	async ({ projectId, folder }: RemoveSourceFolder): Promise<number> => {
		const prefix = folderPrefix(folder, isKnowledgePath);
		if (ports.locks.held(ports.copy.folder(projectId))) throw heldNow();
		await ports.reconcile(projectId);
		const document = await ports.documents.open(projectId);
		const paths = [...document.entries().keys()].filter((path) =>
			path.startsWith(prefix),
		);
		await document.apply({ delete: paths });
		await ports.reconcile(projectId);
		return paths.length;
	};
