import type { KnowledgeDocuments, MeasureNotes } from "./ports";

export type MeasureKnowledgeDocumentsPorts = {
	documents: Pick<KnowledgeDocuments, "sizes">;
	/** Where the sizes go. Without it, nowhere. */
	notes?: MeasureNotes;
};

/**
 * Notes the size of each knowledge document this Replica keeps, for the
 * anonymous usage: Yjs keeps a deleted entry for ever, so this is its
 * growth. The timer of Night Shift asks it once a day.
 */
export const measureKnowledgeDocuments =
	(ports: MeasureKnowledgeDocumentsPorts) => async (): Promise<void> => {
		for (const size of await ports.documents.sizes()) {
			ports.notes?.note({ kind: "knowledge-document-measured", ...size });
		}
	};
