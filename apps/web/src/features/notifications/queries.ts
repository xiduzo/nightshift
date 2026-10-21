/**
 * The query and mutation options of the person's notification settings
 * and screens (`@nightshift/client`, on this app's client).
 */

import {
	createNotificationMutations,
	createNotificationQueries,
} from "@nightshift/client";

import { orpc } from "@/shared/api";

export const notificationQueries = createNotificationQueries(orpc);

export const notificationMutations = createNotificationMutations(orpc);
