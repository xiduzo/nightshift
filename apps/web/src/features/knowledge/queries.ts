/** The query options of a project's knowledge. */

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
	/** One file, by its path in the knowledge. */
	read: (projectId: string, path: string) =>
		orpc.knowledge.read.queryOptions({ input: { projectId, path } }),
};
