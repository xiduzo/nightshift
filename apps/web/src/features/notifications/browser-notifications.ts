import { type ShownNotifications, webPathOf } from "@nightshift/client";
import { toast } from "sonner";

import {
	closeNotifications,
	listNotifications,
	showNotification,
} from "./browser";

/**
 * How this browser shows notifications, for the live cache: a toast while
 * this tab has focus (or the browser may not notify), else a notification
 * of this computer with the key as its tag. A later Web Push of the same
 * key replaces it, and a closed Gate closes both. When to show and when
 * to close is the live cache's rule.
 */
export function browserNotifications(
	open: (path: string) => void,
): ShownNotifications {
	return {
		async show(notice) {
			const { title, body } = await notice.describe();
			const path = webPathOf(notice.route);
			const granted =
				typeof Notification !== "undefined" &&
				Notification.permission === "granted";
			if (document.hasFocus() || !granted) {
				toast(title, {
					id: notice.data.key,
					description: body,
					action: { label: "Open", onClick: () => open(path) },
				});
				return;
			}
			await showNotification({
				key: notice.data.key,
				kind: notice.data.kind,
				title,
				body,
				path,
				onClick: () => open(path),
			});
		},
		async close(key) {
			toast.dismiss(key);
			await closeNotifications(key);
		},
		list: listNotifications,
	};
}
