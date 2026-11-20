import type { Place } from "../capabilities";
import { MECHANISM as M } from "./kinds";

/** The verticals of `apps/desktop` (`scripts/capabilities.ts` says how to place one). */
export const APP_DESKTOP: Record<string, Place> = {
	// The desktop app is the shell around the daemon. Only its
	// notifications are a product area. The rest starts, guards, updates
	// and decorates the app.
	"features/daemon": M,
	"features/external": M,
	"features/moon": M,
	"features/notifications": "notifications",
	"features/updates": M,
	"features/watchdog": M,
};
