import { listedFiles } from "../domain/listing";
import type { KnowledgeFile } from "../domain/paths";
import type { KnowledgeEntries } from "./ports";

export type ListDocumentFilesPorts = { documents: KnowledgeEntries };

/** Which project's knowledge to list. */
export type ListDocumentFiles = { projectId: string };

/**
 * The files the document lists now, by path: no reconcile, no Host. The
 * proposed learnings and the question set are left out. Night Shift asks
 * it for the review and the use of the files.
 */
export const listDocumentFiles =
	(ports: ListDocumentFilesPorts) =>
	async ({ projectId }: ListDocumentFiles): Promise<KnowledgeFile[]> =>
		listedFiles((await ports.documents.open(projectId)).entries());
