import type { KnowledgeDocuments, SpaceStatus } from "../../sync";
import { type ListedReads, listedLearnings } from "../domain/proposed";

export type CountWaitingNotesPorts = {
	status: Pick<SpaceStatus, "spaceOf">;
	documents: Pick<KnowledgeDocuments, "open">;
	archive: ListedReads["archive"];
};

/** The project whose notes to count. */
export type CountWaitingNotes = { projectId: string };

/**
 * How many notes wait. A file whose content is not here holds one at
 * least, and no Host is asked: the Knowledge page draws from this.
 */
export const countWaitingNotes =
	(ports: CountWaitingNotesPorts) =>
	async ({ projectId }: CountWaitingNotes): Promise<number> => {
		const learnings = await listedLearnings(ports, projectId, {
			onlyHere: true,
		});
		return learnings.reduce(
			(sum, learning) => sum + (learning.notes?.length ?? 1),
			0,
		);
	};
