import { ENV } from "../env";
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
			},
);
