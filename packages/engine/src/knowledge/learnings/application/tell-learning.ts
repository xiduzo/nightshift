import type { Permissions } from "@nightshift/auth";
import {
	learningNotes,
	proposedLearningOf,
	toldLearningFileName,
} from "@nightshift/flows";
import type { Actor } from "../../../contract";
import { acceptNote, proposedFile } from "../domain/proposed";
import {
	emptyNote,
	learningGone,
	type NotePerson,
	noteIn,
	type WaitingNote,
} from "../domain/waiting";
import type {
	FolderHolds,
	LearningEntries,
	LearningFolder,
	LearningsAccess,
} from "./ports";

const CHANGES_KNOWLEDGE: Permissions = { run: ["start"] };

export type TellLearningPorts = {
	access: LearningsAccess;
	folder: Pick<LearningFolder, "has" | "text" | "append" | "write" | "remove">;
	documents: Pick<LearningEntries, "open">;
	holds: FolderHolds;
	now: () => number;
};

/** The note a person wrote, who wrote it, and the note that waits it replaces. */
export type TellLearning = {
	actor: Actor;
	spaceId: string;
	projectId: string;
	note: string;
	by: NotePerson;
	replaces?: WaitingNote;
};

/**
 * Keeps a note a person wrote, in their own file of `learnings/accepted/`
 * (`told-<person>.md`) with who told it and when: agents read it. With
 * `replaces`, the note takes the place of a note that waits, which leaves
 * its proposed file as a delete does. Refuses an empty note, and a note to
 * replace that no longer waits: then nothing is kept.
 *
 * Refuses a Person who may not change knowledge (`access.openSpace`).
 */
export const tellLearning =
	(ports: TellLearningPorts) =>
	async ({
		actor,
		spaceId,
		projectId,
		note,
		by,
		replaces,
	}: TellLearning): Promise<void> => {
		await ports.access.openSpace(actor, { spaceId, need: CHANGES_KNOWLEDGE });
		if (learningNotes([note]).length === 0) throw emptyNote();
		if (replaces && !proposedLearningOf(replaces.id)) throw learningGone();
		const hold = await ports.holds.startStep(projectId);
		try {
			// What it replaces is found first: when it is gone, nothing is kept.
			const file = replaces
				? await proposedFile(
						replaces.id,
						(at) => ports.folder.text(projectId, at),
						async () => (await ports.documents.open(projectId)).entries(),
					)
				: null;
			const replaced =
				file && replaces
					? { path: file.path, ...noteIn(file.content, replaces) }
					: null;
			await acceptNote(
				{
					has: (at) => ports.folder.has(projectId, at),
					append: (at, text) => ports.folder.append(projectId, at, text),
				},
				toldLearningFileName(by.id),
				note,
				{ how: "told", by, at: ports.now() },
			);
			if (replaced) {
				await (replaced.rest.notes === 0
					? ports.folder.remove(projectId, replaced.path)
					: ports.folder.write(projectId, replaced.path, replaced.rest.text));
			}
		} finally {
			await hold.done();
		}
	};
