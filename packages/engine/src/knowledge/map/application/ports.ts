import type { Permissions } from "@nightshift/auth";
import type { Actor } from "../../../contract";
import type { KnowledgeSearch } from "../../search";
import type { KnowledgeStepHold } from "../../sync";
import type { MapLearning, MapQuestion } from "../domain/map";

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
 * What the search index holds for the Map, and a stamp that changes when
 * that changes.
 * @filledBy engine/knowledge
 */
export type MapIndex = Pick<KnowledgeSearch, "mapStamp" | "forMap">;

/**
 * The knowledge document of a project: the files the Space lists.
 * @filledBy engine/knowledge
 */
export type MapEntries = {
	open(projectId: string): Promise<{ entries(): ReadonlyMap<string, unknown> }>;
};

/**
 * The learnings that wait in a project.
 * @filledBy engine/knowledge
 */
export type MapLearnings = {
	waiting(
		projectId: string,
		options: { onlyHere: boolean },
	): Promise<MapLearning[]>;
};

/**
 * The questions agents asked a project's knowledge, newest first.
 * @filledBy engine/knowledge
 */
export type AskedQuestions = {
	asked(projectId: string): Promise<MapQuestion[]>;
};

/**
 * Holds a project's folder as a step does: what a mark changes there goes
 * to the Space when the hold ends.
 * @filledBy engine/knowledge
 */
export type FolderHolds = {
	startStep(projectId: string): Promise<KnowledgeStepHold>;
};

/**
 * Who may act in a Space for this knowledge request.
 * @filledBy engine/runs
 */
export type MapAccess = {
	openSpace(
		actor: Actor,
		request: { spaceId: string; need?: Permissions },
	): Promise<void>;
};
