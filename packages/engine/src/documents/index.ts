/** The Yjs documents this Replica syncs, by name (`SyncedDocuments`), each kept in its `ydoc` table (`PersistedDocument`). */

export {
	createFlowDocuments,
	type FlowDocument,
	type FlowDocuments,
} from "./flow-documents";
export {
	cloneKey,
	createSpaceDocuments,
	deviceEntries,
	deviceNameIn,
	memberName,
	memberRole,
	projectClones,
	projectEntry,
	recordClone,
	type SpaceDocument,
	type SpaceDocuments,
	type SpaceProject,
	setSpaceUsage,
	spaceProjectSchema,
	spaceUsageOn,
	withoutFolder,
} from "./space";
export {
	createSyncedDocuments,
	documentId,
	documentKind,
	documentName,
	type SyncedDocuments,
} from "./synced-documents";
export { documentRows, type PersistedDocument } from "./ydoc";
