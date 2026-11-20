import type { Database } from "@nightshift/db";
import { project } from "@nightshift/db/schema";
import {
	createSyncedDocuments,
	documentName,
	type SyncedDocuments,
} from "./synced-documents";
import type { PersistedDocument } from "./ydoc";

/**
 * The flow document of one Project: the pair of documents a Link syncs.
 * Only the Yjs adapters of `flows/store/` know what is in them.
 */
export type FlowDocument = {
	readonly projectId: string;
	/** `flows:<projectId>`: the current flows and schedules. */
	readonly current: PersistedDocument;
	/** `flows-history:<projectId>`: the revisions. */
	readonly history: PersistedDocument;
};

/** The flow documents of this Replica's Projects: views of its synced documents. */
export type FlowDocuments = {
	/** The Project's flow document and its history. */
	open(projectId: string): Promise<FlowDocument>;
	/** The documents of every Project this Replica knows. */
	openAll(): Promise<FlowDocument[]>;
	/** Flushes every document. */
	flush(): Promise<void>;
};

export function createFlowDocuments(options: {
	db: Database;
	/** This Replica's synced documents. Default: its own over `db`. */
	documents?: SyncedDocuments;
}): FlowDocuments {
	const { db } = options;
	const documents =
		options.documents ?? createSyncedDocuments({ db: options.db });

	async function open(projectId: string): Promise<FlowDocument> {
		const [current, history] = await Promise.all([
			documents.open(documentName("flows", projectId)),
			documents.open(documentName("flows-history", projectId)),
		]);
		return { projectId, current, history };
	}

	return {
		open,
		async openAll() {
			const rows = await db.select({ id: project.id }).from(project);
			return Promise.all(rows.map((row) => open(row.id)));
		},
		flush: () => documents.flush(),
	};
}
