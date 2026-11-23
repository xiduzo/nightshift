import type { KnowledgePort, KnowledgeUse } from "@nightshift/agents/knowledge";
import type { SessionContribution } from "@nightshift/agents/types";
import type {
	KnowledgeFiles,
	KnowledgeFolders,
	KnowledgeReader,
} from "../../files";
import type { Learnings } from "../../learnings";
import type { PageReaders } from "../../readers";
import type { KnowledgeSearch } from "../../search";
import type { KnowledgeReconciler } from "../../sync";

/**
 * The driven ports of knowledge/steps. Each is filled by another part of
 * the knowledge or by another package (`@filledBy`): the root wire of the
 * knowledge passes them to `wireSteps`.
 */

/**
 * The project's folder on this computer: its path, made when it is not
 * there, and one look at what it holds.
 * @filledBy engine/knowledge
 */
export type StepFolders = Pick<KnowledgeFolders, "folder" | "ensure" | "scan">;

/**
 * Holds the folder for the step: a reconcile first, and `done` for the
 * one after.
 * @filledBy engine/knowledge
 */
export type StepHolds = Pick<KnowledgeReconciler, "startStep">;

/**
 * The index of the folder (`INDEX.md`) and a view of some of its folders.
 * @filledBy engine/knowledge
 */
export type StepFiles = Pick<KnowledgeFiles, "writeIndex" | "openView">;

/**
 * One file of the folder by its path.
 * @filledBy engine/knowledge
 */
export type StepReader = Pick<KnowledgeReader, "read">;

/**
 * The search of the folder, and its index brought up to date.
 * @filledBy engine/knowledge
 */
export type StepSearch = Pick<KnowledgeSearch, "search" | "refresh">;

/**
 * The session's events, with the learnings of its reports proposed for
 * the run's step.
 * @filledBy engine/knowledge
 */
export type StepLearnings = Pick<Learnings, "keepReported">;

/**
 * The project's page reader for a Command step (ADR 39).
 * @filledBy engine/knowledge
 */
export type StepPageReaders = Pick<PageReaders, "forStep">;

/**
 * What an agent is told of the knowledge, from `@nightshift/agents`.
 * @filledBy agents
 */
export type StepBrief = {
	/** `NS_KNOWLEDGE` for the folder. */
	env(folder: string): Record<string, string>;
	/**
	 * The session brief for the folder: the line that says where it is, and
	 * the knowledge tools over `tools` in the project only, which tell
	 * `onUse` of each search and read. With `learnings`, the agent may
	 * propose learnings.
	 */
	session(input: {
		folder: string;
		projectId: string;
		tools: KnowledgePort;
		onUse: (projectId: string, use: KnowledgeUse) => void;
		learnings: boolean;
	}): SessionContribution;
};
