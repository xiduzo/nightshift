import { now as timeNow } from "@nightshift/time";
import type { Access } from "../../access";
import type { Actor } from "../../contract";
import type { Learnings } from "../learnings";
import type { KnowledgeSearch } from "../search";
import type { KnowledgeDocuments, KnowledgeReconciler } from "../sync";
import { fsNotTopicsFile } from "./adapters/out/fs-not-topics-file";
import { drawMap } from "./application/draw-map";
import { markNotTopic } from "./application/mark-not-topic";
import type { AskedQuestions } from "./application/ports";
import type { KnowledgeMap } from "./domain/map";
import { createMapMemo } from "./domain/memo";

/**
 * The wiring of knowledge/map: the one place that builds its real adapters
 * and binds each use case to its ports.
 */

/** What the knowledge gives knowledge/map: the ports another part fills, and what the real adapter stands on. */
export type MapDeps = {
	access: Pick<Access, "openSpace">;
	/** The knowledge folders on this computer (`files`). */
	folders: {
		folder(projectId: string): string;
		ensure(projectId: string): Promise<string>;
	};
	documents: Pick<KnowledgeDocuments, "open">;
	index: Pick<KnowledgeSearch, "mapStamp" | "forMap">;
	learnings: Pick<Learnings, "waiting">;
	asked: AskedQuestions;
	holds: Pick<KnowledgeReconciler, "startStep">;
	/** The clock. Default `now`. */
	now?: () => number;
};

/** The Map of the projects on this computer, bound to its ports. */
export type KnowledgeMaps = {
	/** The Map of a project's knowledge (`drawMap`). */
	map(projectId: string): Promise<KnowledgeMap>;
	/** Marks a word as not a topic, or puts it back (`markNotTopic`). Returns the list. */
	markNotTopic(
		actor: Actor,
		spaceId: string,
		projectId: string,
		mark: { word: string; notTopic: boolean; by: string | null },
	): Promise<string[]>;
};

export function wireMap(deps: MapDeps): KnowledgeMaps {
	const notTopics = fsNotTopicsFile(deps.folders);
	const draw = drawMap({
		documents: deps.documents,
		index: deps.index,
		asked: deps.asked,
		learnings: deps.learnings,
		notTopics,
		memo: createMapMemo(),
	});
	const mark = markNotTopic({
		access: deps.access,
		notTopics,
		holds: deps.holds,
		now: deps.now ?? timeNow,
	});
	return {
		map: (projectId) => draw({ projectId }),
		markNotTopic: (actor, spaceId, projectId, { word, notTopic, by }) =>
			mark({ actor, spaceId, projectId, word, notTopic, by }),
	};
}
