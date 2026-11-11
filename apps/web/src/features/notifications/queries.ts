/**
 * The query options of the person's notification settings and screens
 * (`@nightshift/client`, on this app's client), and their mutations.
 */

import { createNotificationQueries } from "@nightshift/client";

import { orpc } from "@/shared/api";

export const notificationQueries = createNotificationQueries(orpc);

export const notificationMutations = {
	saveSettings: orpc.notifications.settings.save.mutationOptions,
	registerScreen: orpc.notifications.targets.register.mutationOptions,
	removeScreen: orpc.notifications.targets.remove.mutationOptions,
};
