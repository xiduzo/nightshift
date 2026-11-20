import type { Place } from "../capabilities";
import { MECHANISM as M } from "./kinds";

/** The verticals of `apps/server` (`scripts/capabilities.ts` says how to place one). */
export const APP_SERVER: Record<string, Place> = {
	// The `nightshift` command line: a surface that calls the daemon, like
	// the API. It holds no rule of a product area.
	"features/cli": M,
};
