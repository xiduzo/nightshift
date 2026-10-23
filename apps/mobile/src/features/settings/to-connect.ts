import { router } from "expo-router";

/**
 * After Sign out or Remove this phone: the connect screen, alone on the
 * stack. The tabs under Settings go too, so signing in again opens them once.
 */
export function goToConnect() {
	if (router.canDismiss()) router.dismissAll();
	router.replace("/connect");
}
