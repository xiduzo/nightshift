import type { ApiQueryUtils } from "../api";

/** The query options of anonymous usage on this computer. */
export function createUsageQueries(orpc: ApiQueryUtils) {
	return {
		/** The anonymous events that wait, and the last batch that left. */
		outbox: () => orpc.usage.outbox.queryOptions(),
		/** The usage events and the fields each one can send. */
		catalog: () => ({
			...orpc.usage.catalog.queryOptions(),
			staleTime: Number.POSITIVE_INFINITY,
		}),
		/** Makes a new anonymous id. The old one stops matching. */
		resetId: () => orpc.usage.resetId.mutationOptions(),
	};
}
