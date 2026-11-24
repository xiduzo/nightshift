import { now as timeNow } from "@nightshift/time";
import type { Access } from "../../access";
import type { KnowledgeReader } from "../files";
import type { PageReaders } from "../readers";
import type { KnowledgeReconciler } from "../sync";
import { timerWait } from "./adapters/out/timer-wait";
import { listFillingFlows } from "./application/list-filling-flows";
import { listKnowledgeSources } from "./application/list-knowledge-sources";
import type { SourcesSpace } from "./application/ports";
import { removeKnowledgeSource } from "./application/remove-knowledge-source";
import { saveKnowledgeSource } from "./application/save-knowledge-source";
import { syncKnowledgeSource } from "./application/sync-knowledge-source";
import type { KnowledgeSync, SourceRun } from "./domain/syncs";

/**
 * The wiring of knowledge/sources: the one place that builds its real adapters
 * and binds each use case to its ports.
 */

/** What the knowledge gives knowledge/sources: the ports another part fills. */
export type SourcesDeps = {
	access: Pick<Access, "openSpace">;
	/** This Device's files, after a reconcile. */
	files: Pick<KnowledgeReader, "listing">;
	/** Removes a folder for every Device of the Space. */
	reconciler: Pick<KnowledgeReconciler, "removeFolder">;
	readers: Pick<PageReaders, "ready">;
	/** This computer: a source that reads a folder here syncs here. */
	device: { id: string; name: string };
	/** The clock. Default `now`. */
	now?: () => number;
};

/** A project's knowledge sources, as one person in one Space sees them. */
export type KnowledgeSources<Run extends SourceRun = SourceRun> = {
	/** The files and the flows that fill them, with what `can` allows (`listKnowledgeSources`). */
	list: ReturnType<typeof listKnowledgeSources>;
	/** The flows that fill the knowledge, with no reconcile: what `list` says of each (`listFillingFlows`). */
	syncs(projectId: string): Promise<KnowledgeSync[]>;
	/** Adds a source, or changes one the page added (`saveKnowledgeSource`). */
	save: ReturnType<typeof saveKnowledgeSource>;
	/** Removes a source the page added (`removeKnowledgeSource`). Returns how many files it removed. */
	remove: ReturnType<typeof removeKnowledgeSource>;
	/** Syncs a source now: a run of its flow (`syncKnowledgeSource`). */
	sync: ReturnType<typeof syncKnowledgeSource<Run>>;
};

/** The knowledge sources of this Device, in the Space of each request. */
export type Sources = {
	/** The sources in `space`, as the person who asks sees it. Bound for each request. */
	sourcesIn<Run extends SourceRun>(
		space: SourcesSpace<Run>,
	): KnowledgeSources<Run>;
};

export function wireSources(deps: SourcesDeps): Sources {
	const { files, reconciler, readers, device } = deps;
	const wait = timerWait();
	const now = deps.now ?? timeNow;
	return {
		sourcesIn<Run extends SourceRun>(space: SourcesSpace<Run>) {
			const fillingFlows = listFillingFlows({ space, device, wait, now });
			const { access } = deps;
			return {
				list: listKnowledgeSources({ files, readers, fillingFlows }),
				syncs: async (projectId: string) =>
					(await fillingFlows({ projectId })).syncs,
				save: saveKnowledgeSource({ access, space, device }),
				remove: removeKnowledgeSource({ access, space, reconciler }),
				sync: syncKnowledgeSource({ access, space }),
			};
		},
	};
}
