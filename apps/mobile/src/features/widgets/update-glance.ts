import type { GlanceSnapshot } from "@nightshift/client";

import { homeWidgetProps } from "./glance-props";
import { showOnHomeScreen } from "./home-widget";

let last: string | null = null;

/**
 * Shows a snapshot on the home screen widget; null when the phone is not
 * signed in to a Host. A snapshot the widget shows
 * already is skipped, so the system does not count needless reloads.
 * Call it from wherever fresh Gates and runs come in: the app does it when
 * the inbox or the runs refresh, a background push task can do it too.
 */
export function updateGlance(snapshot: GlanceSnapshot | null): void {
	const props = homeWidgetProps(snapshot);
	const text = JSON.stringify(props);
	if (text === last) return;
	try {
		showOnHomeScreen(props);
		last = text;
	} catch {
		// No widget on this build (Expo Go, or the widget target is missing).
	}
}
