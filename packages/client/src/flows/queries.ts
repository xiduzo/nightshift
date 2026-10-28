import type { ApiQueryUtils } from "../api";

/** The query options of flows. */
export function createFlowQueries(orpc: ApiQueryUtils) {
	return {
		/** Every flows query. Invalidate it after a flow changes. */
		all: () => orpc.flows.key(),
		/** Every list of flows, of every project. */
		lists: () => orpc.flows.list.key(),
		/** The flows of one project. */
		list: (projectId: string) =>
			orpc.flows.list.queryOptions({ input: { projectId } }),
		/** Every flow file of a project by name: its flow, null when it is not valid. */
		map: (projectId: string) =>
			orpc.flows.map.queryOptions({ input: { projectId } }),
		/** One flow file: the flow and its issues. */
		get: (projectId: string, name: string) =>
			orpc.flows.get.queryOptions({ input: { projectId, name } }),
		/** What the import of the project's flow folder did that a person must know. */
		notices: (projectId: string) =>
			orpc.flows.notices.queryOptions({ input: { projectId } }),
		/** The values a flow's kept variables carry from one run to the next. */
		kept: (projectId: string, name: string) =>
			orpc.flows.kept.queryOptions({ input: { projectId, name } }),
	};
}

/** The mutation options of flows. */
export function createFlowMutations(orpc: ApiQueryUtils) {
	return {
		save: orpc.flows.save.mutationOptions,
		remove: orpc.flows.remove.mutationOptions,
		dismissNotice: orpc.flows.dismissNotice.mutationOptions,
		resetKept: orpc.flows.resetKept.mutationOptions,
	};
}
