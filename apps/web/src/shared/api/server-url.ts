import { ENV } from "@/env";
import { serverUrlFor } from "./daemon-url";

/** The address of the Night Shift this UI calls (see `serverUrlFor`). */
export const SERVER_URL = serverUrlFor(
	ENV.VITE_SERVER_URL,
	typeof document === "undefined"
		? null
		: {
				origin: window.location.origin,
				servedByDaemon:
					document.querySelector('meta[name="nightshift-daemon"]') !== null,
				desktopDaemonUrl: desktopDaemonUrl(),
			},
);

/** The daemon the desktop window started, when the page runs in it. */
function desktopDaemonUrl(): string | undefined {
	const url = (window as { nightshiftDaemonUrl?: unknown }).nightshiftDaemonUrl;
	return typeof url === "string" ? url : undefined;
}
