import { useQuery } from "@tanstack/react-query";

import type { NotificationSettings } from "@/shared/api";
import { notificationQueries } from "./queries";

/**
 * The Gate urgencies that send you a notification, from your settings.
 * Undefined while they load or when they do not load.
 */
export function usePushUrgencies():
	| NotificationSettings["pushUrgencies"]
	| undefined {
	const settings = useQuery(notificationQueries.settings());
	return settings.data?.pushUrgencies;
}
