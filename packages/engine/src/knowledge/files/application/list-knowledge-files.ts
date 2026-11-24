import { type KnowledgeListing, listedFiles } from "../domain/listing";
import type {
	FolderSync,
	KnowledgeEntries,
	SpaceStatus,
	Wait,
	WaitingNotes,
} from "./ports";

export type ListKnowledgeFilesPorts = {
	sync: FolderSync;
	wait: Wait;
	/** How long the page waits for its reconcile, in ms. */
	pageWaitMs: number;
	status: Pick<SpaceStatus, "spaceOf" | "isShared" | "isOlder">;
	documents: KnowledgeEntries;
	notes: WaitingNotes;
};

/** Which project's knowledge to list. */
export type ListKnowledgeFiles = { projectId: string };

/**
 * The Knowledge page's list: a reconcile first, for a while, so the
 * document has this Device's own changes. Then the document's files
 * and how many notes wait. The reconcile goes on when
 * the wait ends. While a step writes the folder, the page lists the
 * document as it is. The wait is all a Host can cost this read: the
 * count of the notes asks no Host (`WaitingNotes`), so a Host that
 * does not answer never holds the page longer than `pageWaitMs`.
 *
 * A person asks it on the Knowledge page. The API checks who may first.
 */
export const listKnowledgeFiles =
	(ports: ListKnowledgeFilesPorts) =>
	async ({ projectId }: ListKnowledgeFiles): Promise<KnowledgeListing> => {
		await Promise.race([
			ports.sync.reconcileUnlessHeld(projectId),
			ports.wait.wait(ports.pageWaitMs),
		]);
		const spaceId = await ports.status.spaceOf(projectId);
		return {
			files: listedFiles((await ports.documents.open(projectId)).entries()),
			proposed: await ports.notes.count({ projectId }),
			shared: spaceId ? await ports.status.isShared(spaceId) : false,
			olderHost: spaceId ? ports.status.isOlder(spaceId) : false,
			...(await ports.documents.open(projectId).then((document) => ({
				learnsFromRuns: document.learnsFromRunsOn(),
				reader: document.reader(),
			}))),
		};
	};
