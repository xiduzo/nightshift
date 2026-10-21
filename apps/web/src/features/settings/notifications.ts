/**
 * True in the window of the Night Shift desktop app (its preload sets
 * `window.nightshiftDesktop`). The app shows the notifications there.
 */
export function inDesktopApp(): boolean {
	return (
		typeof window !== "undefined" &&
		(window as { nightshiftDesktop?: unknown }).nightshiftDesktop === true
	);
}

/** True when this browser can show desktop notifications. */
export function notificationsSupported(): boolean {
	return typeof window !== "undefined" && "Notification" in window;
}
