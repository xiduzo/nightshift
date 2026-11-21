import type { KnowledgeFolderLocks } from "../domain/folder-locks";
import { reconcileQuietly } from "../domain/merge";
import type { WorkingCopy } from "./ports";

export type ReconcileUnlessHeldPorts = {
	copy: Pick<WorkingCopy, "folder">;
	locks: Pick<KnowledgeFolderLocks, "held">;
	/** The reconcile of a folder (`reconcileFolder`, bound). */
	reconcile(projectId: string): Promise<void>;
};

/** Which project's folder to bring in step. */
export type ReconcileUnlessHeld = { projectId: string };

/**
 * A reconcile that leaves the folder as it is when it fails. None while a
 * step writes the folder. The Knowledge page asks it before it lists.
 */
export const reconcileUnlessHeld =
	(ports: ReconcileUnlessHeldPorts) =>
	({ projectId }: ReconcileUnlessHeld): Promise<unknown> =>
		ports.locks.held(ports.copy.folder(projectId))
			? Promise.resolve()
			: reconcileQuietly(ports.reconcile, projectId);
