/**
 * The query options of schedules, and how often they poll
 * (`@nightshift/client`, on this app's client), and their mutations.
 */

import { createScheduleQueries } from "@nightshift/client";

import { orpc } from "@/shared/api";

export const scheduleQueries = createScheduleQueries(orpc);

export const scheduleMutations = {
	save: orpc.schedules.save.mutationOptions,
};
