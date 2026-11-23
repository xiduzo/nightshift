import type { Permissions } from "@nightshift/auth";
import type { Actor } from "../../../contract";
import type { KnowledgeFile } from "../../files";
import type { ProjectLearning } from "../../learnings";
import type { KnowledgeSync, SourcesSpace } from "../../sources";
import type { KnowledgeStepHold } from "../../sync";
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

/**
 * Holds a project's folder as a step does: what a mark changes there goes
 * to the Space when the hold ends.
 * @filledBy engine/knowledge
 */
export type FolderHolds = {
	startStep(projectId: string): Promise<KnowledgeStepHold>;
};

/**
 * The files the project's knowledge document lists.
 * @filledBy engine/knowledge
 */
export type ListedFiles = {
	files(projectId: string): Promise<KnowledgeFile[]>;
};

/**
 * The flows that fill the knowledge, in the Space as the person who asks
 * sees it.
 * @filledBy engine/knowledge
 */
export type SourceSyncs = {
	syncs(space: SourcesSpace, projectId: string): Promise<KnowledgeSync[]>;
};

/**
 * The learnings that wait in these projects, newest first.
 * @filledBy engine/knowledge
 */
export type WaitingLearnings = {
	learnings(projectIds: readonly string[]): Promise<ProjectLearning[]>;
};

/**
 * Who may act in a Space for this knowledge request.
 * @filledBy engine/runs
 */
export type ReviewAccess = {
	openSpace(
		actor: Actor,
		request: { spaceId: string; need?: Permissions },
	): Promise<void>;
};
