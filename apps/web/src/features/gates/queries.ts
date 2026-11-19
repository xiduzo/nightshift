/** The query options of Gates (`@nightshift/client`, on this app's client). */

import { createGateQueries, createRunQueries } from "@nightshift/client";

import { orpc } from "@/shared/api";

export const gateQueries = createGateQueries(orpc);

/**
 * The runs the inbox lists: the ones that are not done. The runs vertical
 * imports gates, so gates builds the runs' factory here, on the same cache.
 */
export const runQueries = createRunQueries(orpc);

/** The inbox resumes a sleeping run. */
export const runMutations = {
	resume: orpc.runs.resume.mutationOptions,
};
