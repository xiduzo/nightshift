import { isReadable } from "../../files";
import { type KnowledgeMap, knowledgeMapOf, MAP_LIMITS } from "../domain/map";
import type { MapMemo } from "../domain/memo";
import { parseNotTopics } from "../domain/not-topics";
import type {
	AskedQuestions,
	MapEntries,
	MapIndex,
	MapLearnings,
	NotTopicsFile,
} from "./ports";

export type DrawMapPorts = {
	entries: MapEntries;
	index: MapIndex;
	asked: AskedQuestions;
	learnings: MapLearnings;
	notTopics: Pick<NotTopicsFile, "read">;
	/** Each project's last Map: the wire makes it once (decision 21). */
	memo: MapMemo;
};

/** Which project's Map. */
export type DrawMap = { projectId: string };

/**
 * The Map: the files, the topics they share, the files close in meaning,
 * the questions that found them and the learnings that name their topics.
 * It reads the cheap parts at once: what the Space lists, the index's
 * stamp, the questions, the learnings that wait here and the words people
 * marked. Only when one of them changed does it read the index and draw
 * again. Drawing never asks the Host, nor any model.
 *
 * It checks no role: the `Knowledge` door has no actor yet (E-doors adds it).
 */
export const drawMap =
	(ports: DrawMapPorts) =>
	async ({ projectId }: DrawMap): Promise<KnowledgeMap> => {
		const [listed, stamp, asked, waiting, marked] = await Promise.all([
			ports.entries.open(projectId).then((document) => document.entries()),
			ports.index.mapStamp(projectId),
			ports.asked.asked(projectId),
			ports.learnings.waiting(projectId, { onlyHere: true }),
			ports.notTopics.read(projectId).then(parseNotTopics),
		]);
		const spaceFiles = [...listed.keys()].filter(isReadable);
		const notTopics = marked.map(({ word }) => word);
		return ports.memo(
			projectId,
			[
				stamp,
				spaceFiles,
				asked.map(({ query, hits }) => [query, hits.map((hit) => hit.path)]),
				waiting.map(({ id, notes }) => [id, notes]),
				notTopics,
			],
			async () => {
				const index = await ports.index.forMap(projectId, MAP_LIMITS);
				return knowledgeMapOf({
					// What the Space lists, and what this folder has but did not publish yet.
					files: [...spaceFiles, ...index.files],
					read: index.read,
					filesLeftOut: index.filesLeftOut,
					vectors: index.vectors,
					closeAt: index.closeAt,
					asked,
					learnings: waiting,
					notTopics,
				});
			},
		);
	};
