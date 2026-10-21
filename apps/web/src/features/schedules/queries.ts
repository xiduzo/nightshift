/**
 * The query and mutation options of schedules, and how often they poll
 * (`@nightshift/client`, on this app's client).
 */

import {
	createScheduleMutations,
	createScheduleQueries,
} from "@nightshift/client";

import { orpc } from "@/shared/api";

export const scheduleQueries = createScheduleQueries(orpc);

export const scheduleMutations = createScheduleMutations(orpc);
