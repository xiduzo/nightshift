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
		/** The revisions of a flow, newest first. */
		revisions: (projectId: string, name: string) =>
			orpc.flows.revisions.queryOptions({ input: { projectId, name } }),
		/** The list of a flow's revisions. Invalidate it, and `revisionKey`, after the flow is saved. */
		revisionsKey: (projectId: string, name: string) =>
			orpc.flows.revisions.key({ input: { projectId, name } }),
		/** Every revision read of one flow: each compares with the flow as it is now. */
		revisionKey: (projectId: string, name: string) =>
			orpc.flows.revision.key({ input: { projectId, name } }),
		/**
		 * One revision with its flow, and the diff to it from `against`:
		 * another revision, or the flow as it is now when left out.
		 */
		revision: (
			projectId: string,
			name: string,
			revisionId: string,
			against?: string,
		) =>
			orpc.flows.revision.queryOptions({
				input: {
					projectId,
					name,
					revisionId,
					...(against !== undefined ? { against } : {}),
				},
			}),
		/** The flow as a JSON file. Fetch it when the person exports: it is never cached. */
		export: (projectId: string, name: string) => ({
			...orpc.flows.export.queryOptions({ input: { projectId, name } }),
			staleTime: 0,
			gcTime: 0,
		}),
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
		restore: orpc.flows.restore.mutationOptions,
		import: orpc.flows.import.mutationOptions,
		copy: orpc.flows.copy.mutationOptions,
		resetKept: orpc.flows.resetKept.mutationOptions,
	};
}
