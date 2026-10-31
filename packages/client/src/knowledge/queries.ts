import type { ApiQueryUtils } from "../api";

/**
 * The query options of the learnings that wait. No list polls: the live
 * cache reads them again when a person keeps or deletes some
 * (`learnings-changed`), and when a run changes, since a step that ends
 * may have proposed new ones.
 */
export function createKnowledgeQueries(orpc: ApiQueryUtils) {
	return {
		/** Every list of learnings that wait. */
		learningsKey: () => orpc.knowledge.learnings.key(),
		/** Every read of a project's knowledge: it counts the learnings that wait. */
		getKey: () => orpc.knowledge.get.key(),
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
		/** Keeps one step's learnings: agents read them in later runs. */
		keep: () => orpc.knowledge.keepLearning.mutationOptions(),
		/** Deletes one step's learnings. */
		delete: () => orpc.knowledge.deleteLearning.mutationOptions(),
	};
}
