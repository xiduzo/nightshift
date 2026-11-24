import type { MapQuestion } from "../domain/map";

/**
 * The driven ports of knowledge/map. A port of its own has a real adapter,
 * an in-memory adapter and a contract suite in `adapters/out/`. Another
 * slice or package fills a port with `@filledBy`: the composition of the
 * package passes it to `wireMap`.
 */

/**
 * The file of the words that are not topics (`evals/not-topics.json`), in
 * a project's knowledge folder on this computer. The real adapter is
 * `fs-not-topics-file.ts`.
 */
export type NotTopicsFile = {
	/** The file's text, or null: no such file. */
	read(projectId: string): Promise<string | null>;
	/** Makes the folder when it is not there, and writes the whole file at once. */
	write(projectId: string, text: string): Promise<void>;
};

/**
 * The questions agents asked a project's knowledge, newest first.
 * @filledBy engine/knowledge
 */
export type AskedQuestions = {
	asked(request: { projectId: string }): Promise<MapQuestion[]>;
};
