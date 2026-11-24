import type { KnowledgeDocuments } from "../../sync";

export type ReadLearnsFromRunsPorts = {
	documents: Pick<KnowledgeDocuments, "open">;
};

/** The project to ask about. */
export type ReadLearnsFromRuns = { projectId: string };

/**
 * Whether Night Shift proposes learnings from the runs of the project
 * that ended (ADR 37): on unless a person turned it off.
 */
export const readLearnsFromRuns =
	(ports: ReadLearnsFromRunsPorts) =>
	async ({ projectId }: ReadLearnsFromRuns): Promise<boolean> =>
		(await ports.documents.open(projectId)).learnsFromRunsOn();
