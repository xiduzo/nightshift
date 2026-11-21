import type { KnowledgeFolderLocks } from "../domain/folder-locks";
import type { WorkingCopy } from "./ports";

export type RetryPendingFoldersPorts = {
	copy: Pick<WorkingCopy, "folder">;
	locks: Pick<KnowledgeFolderLocks, "held">;
	/** The projects whose content waits for the Host. */
	pending: ReadonlySet<string>;
	/** The reconcile of a folder (`reconcileFolder`, bound). */
	reconcile(projectId: string): Promise<void>;
};

/**
 * Reconciles the folders whose content waits for the Host, but not one a
 * step writes now. A failure waits for the next time. The timer of Night
 * Shift asks it.
 */
export const retryPendingFolders =
	(ports: RetryPendingFoldersPorts) => async (): Promise<void> => {
		for (const projectId of [...ports.pending]) {
			if (ports.locks.held(ports.copy.folder(projectId))) continue;
			await ports.reconcile(projectId).catch(() => {});
		}
	};
