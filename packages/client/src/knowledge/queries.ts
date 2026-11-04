import type { ApiQueryUtils } from "../api";

/**
 * The query options of a project's knowledge. No list polls: the live cache
 * reads the learnings and the review again when this computer's reconcile
 * finds that they changed (`learnings-changed`), and when a run changes, since
 * a step that ends on another computer may have proposed new ones.
 *
 * A mutation with a rule is here (`keep`, `delete`: `useSettleLearnings` holds
 * the rule). The others are the app's `orpc` ones, used as they are.
 */
export function createKnowledgeQueries(orpc: ApiQueryUtils) {
	return {
		/** Every read of the knowledge. */
		all: () => orpc.knowledge.key(),
		/** Every list of learnings that wait. */
		learningsKey: () => orpc.knowledge.learnings.key(),
		/** Every read of a project's knowledge: it counts the learnings that wait. */
		getKey: () => orpc.knowledge.get.key(),
		/** Every read of what waits for a person on the Knowledge page. */
		reviewKey: () => orpc.knowledge.review.key(),
		/** The files of the project's knowledge and the flows that fill them. */
		get: (projectId: string) =>
			orpc.knowledge.get.queryOptions({ input: { projectId } }),
		/**
		 * What waits for a person on the Knowledge page, in the order a person
		 * meets it. A failed read again keeps the list.
		 */
		review: (projectId: string) => ({
			...orpc.knowledge.review.queryOptions({ input: { projectId } }),
			meta: { quietRefetchErrors: true },
		}),
		/**
		 * The learnings that wait for a person, newest first: of one
		 * project, or of every project of the Space. A failed read again
		 * keeps the list.
		 */
		learnings: (projectId?: string) => ({
			...orpc.knowledge.learnings.queryOptions({
				input: projectId === undefined ? {} : { projectId },
			}),
			meta: { quietRefetchErrors: true },
		}),
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
		/** The question set against each way to search, run on this computer. */
		evaluate: (projectId: string) =>
			orpc.knowledge.evaluate.queryOptions({ input: { projectId } }),
		/** How often agents found and read each file, and which no run used lately. */
		use: (projectId: string) =>
			orpc.knowledge.use.queryOptions({ input: { projectId } }),
		/** The Map: the files, their topics and what connects to them. */
		map: (projectId: string) =>
			orpc.knowledge.graph.queryOptions({ input: { projectId } }),
		/** One file, by its path in the knowledge. */
		read: (projectId: string, path: string) =>
			orpc.knowledge.read.queryOptions({ input: { projectId, path } }),
		/** Keeps one step's learnings: agents read them in later runs. */
		keep: () => orpc.knowledge.keepLearning.mutationOptions(),
		/** Deletes one step's learnings. */
		delete: () => orpc.knowledge.deleteLearning.mutationOptions(),
	};
}
