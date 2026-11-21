import type { KnowledgeFolderLocks } from "../domain/folder-locks";
import { formatReconcileState, parseReconcileState } from "../domain/merge";
import type { ContentArchive, KnowledgeDocuments, WorkingCopy } from "./ports";

export type MoveProjectKnowledgePorts = {
	copy: Pick<
		WorkingCopy,
		"folder" | "readState" | "writeState" | "exists" | "move"
	>;
	documents: Pick<KnowledgeDocuments, "open" | "remove">;
	archive: Pick<ContentArchive, "here">;
	locks: Pick<KnowledgeFolderLocks, "inTurn">;
	/** The projects whose content waits for the Host. */
	pending: Set<string>;
};

/** A Project of a Space move: its Space and id before, and after (`ProjectsMoved` of the run). */
export type MoveProjectKnowledge = {
	from: { spaceId: string; projectId: string };
	to: { spaceId: string; projectId: string };
};

/**
 * Moves a Project's knowledge after a Space move, after the reconciles of
 * both folders that are under way. Its next reconcile copies the content
 * to the new Space's Host. Night Shift asks it when Projects moved.
 */
export const moveProjectKnowledge =
	(ports: MoveProjectKnowledgePorts) =>
	(project: MoveProjectKnowledge): Promise<void> => {
		const fromRoot = ports.copy.folder(project.from.projectId);
		const toRoot = ports.copy.folder(project.to.projectId);
		return ports.locks.inTurn(fromRoot, () =>
			fromRoot === toRoot
				? moveOnce(ports, project)
				: ports.locks.inTurn(toRoot, () => moveOnce(ports, project)),
		);
	};

/**
 * A Project moved to another Space, and maybe to another id there (a
 * Device that joins a Space whose Project has its remote). Its content
 * goes into the new Space's archive here, and waits there for the new
 * Space's Host as unpushed content. With a new id, its folder becomes
 * the new id's folder (a file the new folder has already stays when it
 * is newer), its old document goes, and the next reconcile is an import:
 * it publishes every file into the new id's document, and the later
 * change wins. Nothing happens for a Project with no knowledge here.
 */
async function moveOnce(
	ports: MoveProjectKnowledgePorts,
	{ from, to }: MoveProjectKnowledge,
): Promise<void> {
	const { copy, archive } = ports;
	const renamed = from.projectId !== to.projectId;
	const state = parseReconcileState(await copy.readState(from.projectId));
	const document = await ports.documents.open(from.projectId);
	const unpushed = new Set(state?.unpushed ?? []);
	for (const entry of document.entries().values()) {
		if (!entry.local) unpushed.add(entry.sha256);
	}
	if (from.spaceId !== to.spaceId) {
		for (const sha256 of [...unpushed]) {
			const content = await archive.here
				.read({ kind: "content", spaceId: from.spaceId, sha256 })
				.catch(() => null);
			if (!content) {
				// Not here: the Host of the old Space has it, or nobody does.
				unpushed.delete(sha256);
				continue;
			}
			await archive.here.write({
				ref: { kind: "content", spaceId: to.spaceId, sha256 },
				content,
			});
		}
	}
	const hasFolder = await copy.exists(from.projectId);
	if (!renamed) {
		if (!hasFolder && unpushed.size === 0) return;
		await copy.writeState(
			to.projectId,
			formatReconcileState({
				files: state?.files ?? {},
				unpushed: [...unpushed],
			}),
		);
		ports.pending.add(to.projectId);
		return;
	}
	if (hasFolder) await copy.move(from.projectId, to.projectId);
	await ports.documents.remove(from.projectId);
	if (!hasFolder && unpushed.size === 0) return;
	// The state of the new folder knows none of its files: an import.
	const before = parseReconcileState(await copy.readState(to.projectId));
	await copy.writeState(
		to.projectId,
		formatReconcileState({
			files: {},
			unpushed: [...new Set([...(before?.unpushed ?? []), ...unpushed])],
		}),
	);
	ports.pending.add(to.projectId);
}
