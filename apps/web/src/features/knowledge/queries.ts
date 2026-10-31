/** The query options of a project's knowledge, and its mutations. */

import { orpc } from "@/shared/api";

export const knowledgeQueries = {
	/** The files on this computer and the flows that fill them. */
	get: (projectId: string) =>
		orpc.knowledge.get.queryOptions({ input: { projectId } }),
	/** The files that best match the words, best first. */
	search: (projectId: string, query: string) =>
		orpc.knowledge.search.queryOptions({
			input: { projectId, query, limit: 20 },
		}),
	/** Whether search finds by meaning on this computer. */
	meaning: (projectId: string) =>
		orpc.knowledge.meaning.queryOptions({ input: { projectId } }),
	/** What agents asked the knowledge, and the project's question set. */
	questions: (projectId: string) =>
		orpc.knowledge.questions.queryOptions({ input: { projectId } }),
	/** One file, by its path in the knowledge. */
	read: (projectId: string, path: string) =>
		orpc.knowledge.read.queryOptions({ input: { projectId, path } }),
};

export const knowledgeMutations = {
	/** Adds a source, or changes one: its flow and its schedule. */
	saveSource: orpc.knowledge.saveSource.mutationOptions,
	/** Removes a source, and its files if asked. */
	removeSource: orpc.knowledge.removeSource.mutationOptions,
	/** Runs a source the page added now, where its schedule runs it. */
	syncSource: orpc.knowledge.syncSource.mutationOptions,
	/** Marks the files that answer a question, or with none takes it out of the set. */
	markQuestion: orpc.knowledge.markQuestion.mutationOptions,
};
