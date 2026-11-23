import type { Permissions } from "@nightshift/auth";
import type { Actor } from "../../../contract";
import {
	formatNotTopics,
	markNotTopic as marked,
	parseNotTopics,
} from "../domain/not-topics";
import type { FolderHolds, MapAccess, NotTopicsFile } from "./ports";

const CHANGES_KNOWLEDGE: Permissions = { run: ["start"] };

export type MarkNotTopicPorts = {
	access: MapAccess;
	notTopics: NotTopicsFile;
	holds: FolderHolds;
	now: () => number;
};

/** The word, whether it is not a topic, and who marks it. */
export type MarkNotTopic = {
	actor: Actor;
	spaceId: string;
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
 * Refuses a Person who may not change knowledge (`access.openSpace`).
 */
export const markNotTopic =
	(ports: MarkNotTopicPorts) =>
	async ({
		actor,
		spaceId,
		projectId,
		...mark
	}: MarkNotTopic): Promise<string[]> => {
		await ports.access.openSpace(actor, { spaceId, need: CHANGES_KNOWLEDGE });
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
