/** True when this browser can show desktop notifications. */
export function notificationsSupported(): boolean {
	return typeof window !== "undefined" && "Notification" in window;
}
