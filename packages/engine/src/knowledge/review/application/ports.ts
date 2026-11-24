import type { KnowledgeUseRow } from "../domain/use";

/**
 * The driven ports of knowledge/review. A port of its own has a real adapter,
 * an in-memory adapter and a contract suite in `adapters/out/`. Another
 * slice or package fills a port with `@filledBy`: the composition of the
 * package passes it to `wireReview`.
 */

/**
 * The file of the question set (`evals/questions.json`), in a project's
 * knowledge folder on this computer. The real adapter is
 * `fs-question-set-file.ts`.
 */
export type QuestionSetFile = {
	/** The file's text, or null: no such file. */
	read(projectId: string): Promise<string | null>;
	/** Makes the folder when it is not there, and writes the whole file at once. */
	write(projectId: string, text: string): Promise<void>;
};

/**
 * The searches and reads of agents in a project's knowledge, from the
 * event log, newest first. The real adapter is
 * `drizzle-knowledge-use-log.ts`.
 */
export type KnowledgeUseLog = {
	events(
		projectId: string,
		types: readonly KnowledgeUseRow["type"][],
		options: { limit: number; since?: number },
	): Promise<KnowledgeUseRow[]>;
};
