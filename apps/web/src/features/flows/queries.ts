/** The query options of flows (`@nightshift/client`, on this app's client), and their mutations. */

import { createFlowQueries, createKnowledgeQueries } from "@nightshift/client";

import { orpc } from "@/shared/api";

export const flowQueries = createFlowQueries(orpc);

/** The files of a project's knowledge: the folders an Agent node may read come from them. */
export const knowledgeFolderQueries = {
	files: createKnowledgeQueries(orpc).get,
};

export const flowMutations = {
	save: orpc.flows.save.mutationOptions,
	remove: orpc.flows.remove.mutationOptions,
	dismissNotice: orpc.flows.dismissNotice.mutationOptions,
	restore: orpc.flows.restore.mutationOptions,
	import: orpc.flows.import.mutationOptions,
	copy: orpc.flows.copy.mutationOptions,
	resetKept: orpc.flows.resetKept.mutationOptions,
};
