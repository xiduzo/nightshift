import { now as timeNow } from "@nightshift/time";
import type { Access } from "../../access";
import type { Learnings } from "../learnings";
import type { KnowledgeSearch } from "../search";
import type { KnowledgeDocuments, KnowledgeReconciler } from "../sync";
import { fsNotTopicsFile } from "./adapters/out/fs-not-topics-file";
import { drawMap } from "./application/draw-map";
import { markNotTopic } from "./application/mark-not-topic";
import type { AskedQuestions } from "./application/ports";
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
	map: ReturnType<typeof drawMap>;
	/** Marks a word as not a topic, or puts it back (`markNotTopic`). Returns the list. */
	markNotTopic: ReturnType<typeof markNotTopic>;
};

export function wireMap(deps: MapDeps): KnowledgeMaps {
	const notTopics = fsNotTopicsFile(deps.folders);
	return {
		map: drawMap({
			documents: deps.documents,
			index: deps.index,
			asked: deps.asked,
			learnings: deps.learnings,
			notTopics,
			memo: createMapMemo(),
		}),
		markNotTopic: markNotTopic({
			access: deps.access,
			notTopics,
			holds: deps.holds,
			now: deps.now ?? timeNow,
		}),
	};
}
