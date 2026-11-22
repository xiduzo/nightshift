import { keptNotes, listedLearnings } from "../domain/proposed";
import { byNewest, type WaitingLearning, withNearTo } from "../domain/waiting";
import type {
	CloseNotes,
	ContentArchive,
	LearningEntries,
	LearningsNotifications,
	SpaceStatus,
} from "./ports";

export type ListWaitingLearningsPorts = {
	status: SpaceStatus;
	documents: LearningEntries;
	archive: ContentArchive;
	notifications: LearningsNotifications;
	/** Which notes are close to others. Absent: the list has no `nearTo`. */
	closeNotes?: CloseNotes;
};

/** The project, and whether to ask its Host. */
export type ListWaitingLearnings = {
	projectId: string;
	/** The Host is not asked, what is not here has no notes, and no note is compared. */
	onlyHere?: boolean;
};

/**
 * What waits for a person, newest first, with its notes, as the Space's
 * document has it. No reconcile first: a step publishes what it proposed
 * when it ends. A file whose content is neither here nor at the Host now
 * has no notes. Without `onlyHere`, each carries the notes close to it
 * (`nearTo`), from vectors made in the background: the read never waits
 * for a model. When the vectors are ready, the open screens hear of it.
 *
 * It checks no role: the `Knowledge` door has no actor yet (E-doors adds it).
 */
export const listWaitingLearnings =
	(ports: ListWaitingLearningsPorts) =>
	async ({
		projectId,
		onlyHere,
	}: ListWaitingLearnings): Promise<WaitingLearning[]> => {
		const learnings = (
			await listedLearnings(
				ports,
				projectId,
				onlyHere !== undefined ? { onlyHere } : {},
			)
		)
			.map((learning) => ({ ...learning, notes: learning.notes ?? [] }))
			.sort(byNewest);
		if (onlyHere) return learnings;
		const { closeNotes } = ports;
		const waiting = learnings.flatMap(({ id, notes }) =>
			notes.map((text) => ({ id, text, kept: false })),
		);
		if (!closeNotes || waiting.length === 0) return learnings;
		const close = await closeNotes.among(projectId, {
			notes: async () => [...waiting, ...(await keptNotes(ports, projectId))],
			onPrepared: () => void tellScreens(ports, projectId),
		});
		return close ? withNearTo(learnings, close) : learnings;
	};

/** Lets the open screens of the project's Space read what waits again. */
async function tellScreens(
	ports: Pick<ListWaitingLearningsPorts, "status" | "notifications">,
	projectId: string,
): Promise<void> {
	const spaceId = await ports.status.spaceOf(projectId);
	if (spaceId === null) return;
	await ports.notifications
		.learningsChanged(spaceId, projectId)
		.catch((error: unknown) => {
			console.warn("The screens were not told of the learnings:", error);
		});
}
