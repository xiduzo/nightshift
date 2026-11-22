import { proposedLearningOf } from "@nightshift/flows";
import { acceptNote, proposedFile } from "../domain/proposed";
import {
	learningGone,
	type NotePerson,
	noteIn,
	type WaitingNote,
} from "../domain/waiting";
import type { FolderHolds, LearningEntries, LearningFolder } from "./ports";

export type SettleNotePorts = {
	folder: Pick<LearningFolder, "has" | "text" | "append" | "write" | "remove">;
	documents: Pick<LearningEntries, "open">;
	holds: FolderHolds;
	now: () => number;
};

/** One note of a learning that waits, what a person decided, and who. */
export type SettleNote = {
	projectId: string;
	note: WaitingNote;
	decision: "keep" | "delete";
	by: NotePerson;
};

/**
 * Keeps or deletes one note of a learning that waits: keep adds it to the
 * learning's file in `learnings/accepted/` with who kept it and when, and
 * both take it out of the proposed file. A proposed file with no note left
 * goes. It holds the folder as `settleLearning` does, refuses what it
 * refuses, and a note the file no longer has.
 *
 * It checks no role: the `Knowledge` door has no actor yet (E-doors adds it).
 */
export const settleNote =
	(ports: SettleNotePorts) =>
	async ({ projectId, note, decision, by }: SettleNote): Promise<void> => {
		if (!proposedLearningOf(note.id)) throw learningGone();
		const hold = await ports.holds.startStep(projectId);
		try {
			const { path, content } = await proposedFile(
				note.id,
				(at) => ports.folder.text(projectId, at),
				async () => (await ports.documents.open(projectId)).entries(),
			);
			const found = noteIn(content, note);
			if (decision === "keep") {
				await acceptNote(
					{
						has: (at) => ports.folder.has(projectId, at),
						append: (at, text) => ports.folder.append(projectId, at, text),
					},
					note.id,
					found.note,
					{ how: "kept", by, at: ports.now() },
					found.preface,
				);
			}
			await (found.rest.notes === 0
				? ports.folder.remove(projectId, path)
				: ports.folder.write(projectId, path, found.rest.text));
		} finally {
			await hold.done();
		}
	};
