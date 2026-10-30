/** The query options of a project's knowledge. */

import { orpc } from "@/shared/api";

export const knowledgeQueries = {
	/** The files on this computer and the flows that fill them. */
	get: (projectId: string) =>
		orpc.knowledge.get.queryOptions({ input: { projectId } }),
};
