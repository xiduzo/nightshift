import type { ReviewTask, WaitingLearning } from "@nightshift/client";

/** One close note as the Review page shows it. */
export type ShownCloseNote = {
	/** Unique among the close notes of one note. */
	key: string;
	label: string;
	note: string;
	/** The task that holds it, to go to it. Null: there is no other task to open. */
	taskId: string | null;
};

/**
 * What each note of a learning shows of the notes close to it. The words say
 * "close" and no more: the two notes may repeat each other or disagree, and
 * only a person can tell. A note that also waits shows only while its task is
 * in the queue, so one you just kept or deleted goes at once.
 */
export function closeNotesShown(
	learning: Pick<WaitingLearning, "id" | "notes" | "nearTo">,
	queue: readonly ReviewTask[],
): ShownCloseNote[][] {
	return learning.notes.map((_, index) =>
		(learning.nearTo?.[index] ?? []).flatMap((near): ShownCloseNote[] => {
			const key = `${near.kept ? "kept" : "waits"}:${near.id}:${near.note}`;
			const { note } = near;
			if (near.kept) {
				return [{ key, label: "Close to a kept note", note, taskId: null }];
			}
			if (near.id === learning.id) {
				return [{ key, label: "Close to a note here", note, taskId: null }];
			}
			const task = queue.find(
				(other) => other.kind === "learning" && other.learning.id === near.id,
			);
			return task
				? [
						{
							key,
							label: "Close to a note that also waits",
							note,
							taskId: task.id,
						},
					]
				: [];
		}),
	);
}

/** The title over the close notes of a learning, from how many of its notes have one. */
export function closeNotesTitle(notes: number): string {
	return notes === 1
		? "1 note is close to another"
		: `${notes} notes are close to others`;
}
