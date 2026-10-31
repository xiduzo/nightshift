import type { PushRoute } from "@nightshift/client";
import { router } from "expo-router";

import { phoneRouteOf } from "./push-data";

/**
 * Opens the screen of a push. Needs you is a tab that is always under the
 * other screens: go back to it, so the app keeps one set of tabs.
 */
export function openPhoneRoute(route: PushRoute): void {
	const href = phoneRouteOf(route);
	if (href.pathname === "/needs") router.dismissTo(href);
	else router.push(href);
}
