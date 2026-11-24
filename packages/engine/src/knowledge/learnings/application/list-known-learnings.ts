import type { KnowledgeDocuments, SpaceStatus } from "../../sync";
import {
	keptNotes,
	type ListedReads,
	listedLearnings,
} from "../domain/proposed";

export type ListKnownLearningsPorts = {
	status: Pick<SpaceStatus, "spaceOf">;
	documents: Pick<KnowledgeDocuments, "open">;
	archive: ListedReads["archive"];
};

/** The project whose notes to list. */
export type ListKnownLearnings = { projectId: string };

/**
 * The notes the project has, as this computer has them: the waiting ones,
 * newest first, then the kept ones. No Host is asked. The look back at a
 * run reads them, so it does not propose them again.
 */
export const listKnownLearnings =
	(ports: ListKnownLearningsPorts) =>
	async ({ projectId }: ListKnownLearnings): Promise<string[]> => {
		const waiting = (
			await listedLearnings(ports, projectId, { onlyHere: true })
		)
			.sort((a, b) => b.proposedAt - a.proposedAt)
			.flatMap((learning) => learning.notes ?? []);
		const kept = (await keptNotes(ports, projectId)).map((note) => note.text);
		return [...waiting, ...kept];
	};
