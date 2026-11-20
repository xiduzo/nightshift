import type { Place } from "../capabilities";
import { MECHANISM as M } from "./kinds";

/** The verticals of `packages/daemon` (`scripts/capabilities.ts` says how to place one). */
export const PACKAGE_DAEMON: Record<string, Place> = {
	assistant: "assistant",
	// The harness table of this computer.
	harnesses: "agents",
	// The Hono app and its routes.
	http: M,
	// The OS's sleep lock behind a port. The rule for when to hold it is
	// the engine's.
	"keep-awake": M,
	notifications: "notifications",
	// The boot: the env, the database, the lease, health, the hot slots.
	runtime: M,
	// The transport of the synced documents.
	sync: M,
	// The export's headers, moved from their old store, and the counts of
	// the daily usage event.
	telemetry: M,
};
