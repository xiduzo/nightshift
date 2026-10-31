/** The Yjs documents this Replica syncs, by name (`SyncedDocuments`), each kept in its `ydoc` table (`PersistedDocument`). */

export {
	createSyncedDocuments,
	documentId,
	documentKind,
	documentName,
	type SyncedDocuments,
} from "./synced-documents";
export { documentRows, type PersistedDocument } from "./ydoc";
