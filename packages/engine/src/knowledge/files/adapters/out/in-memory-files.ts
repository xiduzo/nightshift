import { inMemoryLearnings } from "../../../learnings/adapters/out/in-memory-learnings";
import { inMemorySync } from "../../../sync/adapters/out/in-memory-sync";
import { listDocumentFiles } from "../../application/list-document-files";
import { listKnowledgeFiles } from "../../application/list-knowledge-files";
import { openKnowledgeView } from "../../application/open-knowledge-view";
import { readKnowledgeFile } from "../../application/read-knowledge-file";
import { writeKnowledgeIndex } from "../../application/write-knowledge-index";
import type { KnowledgeFiles } from "../../wire";
import { inMemoryKnowledgeFolders } from "./in-memory-knowledge-folders";
import { inMemoryFilesPorts } from "./in-memory-neighbours";

/**
 * The files over in-memory adapters: the real use cases, with what a test
 * publishes in the sync and puts in the folders. The use-case test of every
 * slice that lists or reads the files takes this one. Test code: production
 * code never imports this file.
 */
export function inMemoryFiles(
	sync = inMemorySync(),
	folders = inMemoryKnowledgeFolders(sync.copy.folders),
) {
	const ports = {
		...inMemoryFilesPorts(),
		folders,
		documents: sync.documents,
		status: sync.status,
		archive: sync.archive,
		notes: inMemoryLearnings(sync),
		sync: sync.reconciler,
	};
	const listing = listKnowledgeFiles(ports);
	const files = listDocumentFiles(ports);
	const read = readKnowledgeFile(ports);
	const writeIndex = writeKnowledgeIndex(ports);
	const openView = openKnowledgeView({ views: ports.views, writeIndex });
	const bound = {
		folders,
		reader: {
			listing: (projectId) => listing({ projectId }),
			files: (projectId) => files({ projectId }),
			read: (projectId, path, maxBytes, from) =>
				read({ projectId, path, maxBytes, ...(from ? { from } : {}) }),
		},
		writeIndex: (snapshot) => writeIndex({ snapshot }),
		openView: (source, all, only) =>
			openView({ source, files: all, folders: only }),
	} satisfies KnowledgeFiles;
	return { ...ports, ...bound };
}
