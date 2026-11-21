import type { KnowledgeFolderLocks } from "../domain/folder-locks";
import type { WorkingCopy } from "./ports";

export type ReconcileAllFoldersPorts = {
	copy: Pick<WorkingCopy, "folder" | "known">;
	locks: Pick<KnowledgeFolderLocks, "held">;
	/** The reconcile of a folder (`reconcileFolder`, bound). */
	reconcile(projectId: string): Promise<void>;
};

/**
 * Reconciles every folder on this computer, one after the other: the
 * import on upgrade at the first start, and what waited while the daemon
 * was down. A folder a step holds is left: the step's own reconcile
 * publishes what it writes. The timer of Night Shift asks it.
 */
export const reconcileAllFolders =
	(ports: ReconcileAllFoldersPorts) => async (): Promise<void> => {
		for (const projectId of await ports.copy.known()) {
			if (ports.locks.held(ports.copy.folder(projectId))) continue;
			await ports.reconcile(projectId).catch((error) => {
				console.warn(
					`The knowledge of ${projectId} was not brought in step:`,
					error,
				);
			});
		}
	};
