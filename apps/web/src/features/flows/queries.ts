/** The query options of flows (`@nightshift/client`, on this app's client), and their mutations. */

import { createFlowQueries } from "@nightshift/client";

import { orpc } from "@/shared/api";

export const flowQueries = createFlowQueries(orpc);

export const flowMutations = {
	save: orpc.flows.save.mutationOptions,
	remove: orpc.flows.remove.mutationOptions,
	dismissNotice: orpc.flows.dismissNotice.mutationOptions,
	restore: orpc.flows.restore.mutationOptions,
	import: orpc.flows.import.mutationOptions,
	copy: orpc.flows.copy.mutationOptions,
	resetKept: orpc.flows.resetKept.mutationOptions,
};
