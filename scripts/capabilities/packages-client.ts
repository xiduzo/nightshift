import type { Place } from "../capabilities";
import { MECHANISM as M, WIRING } from "./kinds";

/** The verticals of `packages/client` (`scripts/capabilities.ts` says how to place one). */
export const PACKAGE_CLIENT: Record<string, Place> = {
	// The typed client, its query client and how a call is refused.
	api: M,
	// What a write makes stale: one table for both apps.
	changes: M,
	dashboard: "dashboard",
	devices: "devices",
	flows: "flows",
	gates: "gates",
	// What a widget and a lock-screen run show.
	widgets: "widgets",
	knowledge: "knowledge",
	// The live cache: the one follower of a Host for both apps. It is the
	// composition of the client (rule 6). It makes the Gate queries and the
	// run queries, follows the notifications stream and the run streams,
	// and holds the one rule that needs all three: what each item of the
	// stream reads again, shows and takes away. No capability owns that
	// rule, and each app would pass in the same functions. No vertical
	// imports it: the root entry passes its hooks on to the apps.
	live: WIRING,
	notifications: "notifications",
	projects: "projects",
	runs: "runs",
	schedules: "schedules",
	/** This computer's settings and its Ollama: query keys shared with the apps. */
	settings: "settings",
	spaces: "spaces",
	usage: M,
};
