import {
	formatNotTopics,
	markNotTopic as marked,
	parseNotTopics,
} from "../domain/not-topics";
import type { FolderHolds, NotTopicsFile } from "./ports";

export type MarkNotTopicPorts = {
	notTopics: NotTopicsFile;
	holds: FolderHolds;
	now: () => number;
};

/** The word, whether it is not a topic, and who marks it. */
export type MarkNotTopic = {
	projectId: string;
	word: string;
	notTopic: boolean;
	by: string | null;
};

/**
 * Marks a word as not a topic, so no Map of the Space shows it, or puts
 * it back. It holds the folder as a step does: the list goes to the Space
 * when the hold ends. Returns the list, newest mark first.
 *
 * It checks no role: the `Knowledge` door has no actor yet (E-doors adds it).
 */
export const markNotTopic =
	(ports: MarkNotTopicPorts) =>
	async ({ projectId, ...mark }: MarkNotTopic): Promise<string[]> => {
		const hold = await ports.holds.startStep(projectId);
		try {
			const next = marked(
				parseNotTopics(await ports.notTopics.read(projectId)),
				{
					...mark,
					at: ports.now(),
				},
			);
			await ports.notTopics.write(projectId, formatNotTopics(next));
			return next.map(({ word }) => word);
		} finally {
			await hold.done();
		}
	};
