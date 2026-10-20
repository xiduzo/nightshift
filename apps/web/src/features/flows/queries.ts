/** The query and mutation options of flows. */

import { orpc } from "@/shared/api";

export const flowQueries = {
	/** Every flows query. Invalidate it after a flow changes. */
	all: () => orpc.flows.key(),
	/** Every list of flows, of every project. */
	lists: () => orpc.flows.list.key(),
	/** The flows of one project. */
	list: (projectId: string) =>
		orpc.flows.list.queryOptions({ input: { projectId } }),
	/** One flow file: the flow and its issues. */
	get: (projectId: string, name: string) =>
		orpc.flows.get.queryOptions({ input: { projectId, name } }),
};

export const flowMutations = {
	save: orpc.flows.save.mutationOptions,
	remove: orpc.flows.remove.mutationOptions,
};
