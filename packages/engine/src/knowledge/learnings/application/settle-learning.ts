import { ACCEPTED_LEARNINGS_DIR, proposedLearningOf } from "@nightshift/flows";
import { proposedFile } from "../domain/proposed";
import { learningGone } from "../domain/waiting";
import type { FolderHolds, LearningEntries, LearningFolder } from "./ports";

export type SettleLearningPorts = {
	folder: Pick<LearningFolder, "bytes" | "append" | "remove">;
	documents: Pick<LearningEntries, "open">;
	holds: FolderHolds;
};

/** One step's proposed learnings, by the name of its file, and what a person decided. */
export type SettleLearning = {
	projectId: string;
	id: string;
	decision: "keep" | "delete";
};

/**
 * Keeps or deletes one step's proposed learnings: keep adds the file to
 * `learnings/accepted/`, and both take it out of `learnings/proposed/`. It
 * holds the folder as a step does, so the change goes to the Space when it
 * ends. Refuses a name that is no proposed learning, one that no longer
 * waits, and one whose content cannot be fetched now.
 *
 * It checks no role: the `Knowledge` door has no actor yet (E-doors adds it).
 */
export const settleLearning =
	(ports: SettleLearningPorts) =>
	async ({ projectId, id, decision }: SettleLearning): Promise<void> => {
		if (!proposedLearningOf(id)) throw learningGone();
		const hold = await ports.holds.startStep(projectId);
		try {
			const { path, content } = await proposedFile(
				id,
				(at) => ports.folder.bytes(projectId, at),
				async () => (await ports.documents.open(projectId)).entries(),
			);
			if (decision === "keep") {
				await ports.folder.append(
					projectId,
					`${ACCEPTED_LEARNINGS_DIR}/${id}`,
					content,
				);
			}
			await ports.folder.remove(projectId, path);
		} finally {
			await hold.done();
		}
	};
