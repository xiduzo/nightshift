import type { PageReaderSetting } from "@nightshift/flows";
import {
	KNOWLEDGE_FILES_WARNING,
	type KnowledgeFile,
	type KnowledgeReader,
} from "../../files";
import type { PageReaders } from "../../readers";
import {
	type KnowledgeSync,
	type SourceActions,
	type SourcePermissions,
	sourceActions,
} from "../domain/syncs";
import type { listFillingFlows } from "./list-filling-flows";

export type ListKnowledgeSourcesPorts = {
	files: Pick<KnowledgeReader, "listing">;
	readers: Pick<PageReaders, "ready">;
	/** The flows that fill the knowledge (`listFillingFlows`, bound). */
	fillingFlows: ReturnType<typeof listFillingFlows>;
};

/** Which project, and what the person's role allows on its sources. */
export type ListKnowledgeSources = {
	projectId: string;
	can: SourcePermissions;
};

/** A project's knowledge in its Space, and the flows that fill it. */
export type KnowledgeOverview = {
	/** Every file but the index and the proposed learnings, by path. */
	files: KnowledgeFile[];
	/** So many files that an agent reads it badly. */
	tooLarge: boolean;
	syncs: (KnowledgeSync & { may: SourceActions })[];
	/** How many learnings agents proposed that wait for a person. */
	proposed: number;
	/** The flows of the project that review the learnings, by name. */
	reviews: string[];
	/** The Space is not a personal one: each of its Members reads the knowledge. */
	shared: boolean;
	/** The Host that keeps the Space runs an older version of Night Shift: it cannot take this knowledge yet. */
	olderHost: boolean;
	/** Night Shift proposes learnings from the runs of the project that ended (ADR 37). */
	learnsFromRuns: boolean;
	/** The page reader of the project (ADR 39). */
	reader: PageReaderSetting;
	/** The secret of that reader is saved where this computer finds it. Always true for Night Shift's own. */
	readerReady: boolean;
};

/**
 * The files of the project's knowledge (after a reconcile of this Device's
 * folder), the flows that fill it with their schedules and last runs, what
 * `can` allows on each, and the learnings that wait. All three reads start
 * at once. A project the Space does not have refuses.
 *
 * It checks no role: the API checked `can` (E-doors moves it here).
 */
export const listKnowledgeSources =
	(ports: ListKnowledgeSourcesPorts) =>
	async ({
		projectId,
		can,
	}: ListKnowledgeSources): Promise<KnowledgeOverview> => {
		const [
			{ files, proposed, shared, olderHost, learnsFromRuns, reader },
			{ syncs, reviews },
			readerReady,
		] = await Promise.all([
			ports.files.listing(projectId),
			ports.fillingFlows({ projectId }),
			ports.readers.ready({ projectId }),
		]);
		return {
			files,
			tooLarge: files.length > KNOWLEDGE_FILES_WARNING,
			syncs: syncs.map((sync) => ({
				...sync,
				may: sourceActions(sync, can),
			})),
			proposed,
			reviews,
			shared,
			olderHost,
			learnsFromRuns,
			reader,
			readerReady,
		};
	};
