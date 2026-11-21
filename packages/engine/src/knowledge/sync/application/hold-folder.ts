import type { KnowledgeFolderLocks } from "../domain/folder-locks";
import { reconcileQuietly } from "../domain/merge";
import type { WorkingCopy } from "./ports";

export type HoldFolderPorts = {
	copy: Pick<WorkingCopy, "folder">;
	locks: KnowledgeFolderLocks;
	/** The reconcile of a folder (`reconcileFolder`, bound). */
	reconcile(projectId: string): Promise<void>;
};

/** Which project's folder a step gets. */
export type HoldFolder = { projectId: string };

/** A step's hold on a project's folder: `done` when the step ends. */
export type KnowledgeStepHold = { done(): Promise<void> };

/**
 * A step that gets the project's folder starts: the folder is brought
 * in step with the Space first, and nothing else reconciles it until
 * `done`. Then the reconcile publishes what the step wrote. Steps that
 * share the folder share the hold: the first reconciles before, the
 * last after. A reconcile that fails leaves the folder as it is. A step of
 * Night Shift asks it, and each change a person makes in the folder.
 */
export const holdFolder =
	(ports: HoldFolderPorts) =>
	async ({ projectId }: HoldFolder): Promise<KnowledgeStepHold> => {
		const { locks } = ports;
		const root = ports.copy.folder(projectId);
		// A step that shares the folder waits for the first one's reconcile.
		if (locks.hold(root)) await reconcileQuietly(ports.reconcile, projectId);
		else await locks.turnsEnded(root);
		let released = false;
		return {
			async done() {
				if (released) return;
				released = true;
				if (locks.release(root)) {
					await reconcileQuietly(ports.reconcile, projectId);
				}
			},
		};
	};
