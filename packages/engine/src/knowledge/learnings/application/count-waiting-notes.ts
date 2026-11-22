import { listedLearnings } from "../domain/proposed";
import type { ContentArchive, LearningEntries, SpaceStatus } from "./ports";

export type CountWaitingNotesPorts = {
	status: SpaceStatus;
	documents: LearningEntries;
	archive: ContentArchive;
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
