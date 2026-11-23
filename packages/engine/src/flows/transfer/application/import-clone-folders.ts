import type { CloneHere } from "../domain/clone-import";
import type { ImportRuns } from "../domain/import-runs";
import {
	type ImportCloneFolderPorts,
	importCloneFolder,
} from "./import-clone-folder";
import type { ClonesHere } from "./ports";

export type ImportCloneFoldersPorts = ImportCloneFolderPorts & {
	clones: ClonesHere;
	/** The imports running now: one per Clone at a time. */
	runs: ImportRuns;
};

/**
 * When the import of a Clone's folder runs: for every Clone on this
 * Device when the engine starts, and for the Clone of a project a person
 * adds (`projectId`). Each Clone is imported once. An import that fails
 * is logged and tried again at the next start. Never throws.
 */
export const importCloneFolders = (ports: ImportCloneFoldersPorts) => {
	const importOne = importCloneFolder(ports);
	const once = (clone: CloneHere) =>
		ports.runs.once(clone.id, () =>
			importOne({ clone })
				.then(() => {})
				.catch((error) => {
					console.warn(
						"Night Shift could not import the flow folder of a project. It tries again at the next start:",
						error,
					);
				}),
		);
	return async (request: { projectId?: string }): Promise<void> => {
		const { projectId } = request;
		const listed = (async () => {
			const { id } = await ports.device.device();
			return ports.clones.list(id, projectId);
		})();
		const clones = await listed.catch((error) => {
			if (projectId === undefined) {
				console.warn("Night Shift could not list the project folders:", error);
			}
			return [];
		});
		for (const clone of clones) await once(clone);
	};
};
