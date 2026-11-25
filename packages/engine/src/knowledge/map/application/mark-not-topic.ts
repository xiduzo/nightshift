import type { Permissions } from "@nightshift/auth";
import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import type { KnowledgeReconciler } from "../../sync";
import { markNotTopic as marked, parseNotTopics } from "../domain/not-topics";
import type { NotTopicsFile } from "./ports";

const CHANGES_KNOWLEDGE: Permissions = { run: ["start"] };

export type MarkNotTopicPorts = {
	access: Pick<Access, "openSpace">;
	notTopics: NotTopicsFile;
	holds: Pick<KnowledgeReconciler, "startStep">;
	now: () => number;
};

/** The word, whether it is not a topic, and who marks it. */
export type MarkNotTopic = {
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
 * Refuses a Person who may not change knowledge (`access.openSpace`), and
 * a list it cannot read (`conflict`).
 */
export const markNotTopic =
	(ports: MarkNotTopicPorts) =>
	async (
		actor: Actor,
		{ spaceId, projectId, ...mark }: MarkNotTopic,
	): Promise<string[]> => {
		await ports.access.openSpace(actor, { spaceId, need: CHANGES_KNOWLEDGE });
		const hold = await ports.holds.startStep(projectId);
		try {
			const next = marked(await ports.notTopics.read(projectId), {
				...mark,
				at: ports.now(),
			});
			await ports.notTopics.write(projectId, next);
			return parseNotTopics(next).map(({ word }) => word);
		} finally {
			await hold.done();
		}
	};
