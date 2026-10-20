import { HEALTH_STALE_AFTER_MS } from "server/src/health";

import type { WatchdogStart } from "./watchdog-worker";

/**
 * The watchdog of the daemon this app runs. Under a Bun bug, the daemon's
 * timers can stop while it still answers HTTP: the lease heartbeat, the
 * scheduler and the runs' deadlines stop with them. A Worker keeps its own
 * timers (checked: they go on when the main thread's stop). Every 15 s it
 * reads the heartbeat from the database; after two stale reads it kills
 * the app. Opening the app again picks up the interrupted runs.
 */
export function startWatchdog(options: {
	database: string;
	owner: string;
	checkEveryMs?: number;
	staleAfterMs?: number;
}): Worker {
	const worker = new Worker(new URL("./watchdog-worker.ts", import.meta.url));
	worker.postMessage({
		database: options.database,
		owner: options.owner,
		checkEveryMs: options.checkEveryMs ?? 15_000,
		staleAfterMs: options.staleAfterMs ?? HEALTH_STALE_AFTER_MS,
	} satisfies WatchdogStart);
	return worker;
}
