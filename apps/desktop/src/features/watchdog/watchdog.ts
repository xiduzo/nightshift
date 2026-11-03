import { HEALTH_STALE_AFTER_MS } from "@nightshift/daemon";

import type { WatchdogMessage } from "./watchdog-worker";

/**
 * The watchdog of the daemon this app runs. Under a Bun bug, the daemon's
 * timers can stop while it still answers HTTP: the lease heartbeat, the
 * scheduler and the runs' deadlines stop with them. A Worker keeps its own
 * timers (checked: they go on when the main thread's stop). The daemon
 * tells it of each lease heartbeat (`heartbeat`). Every 15 s it checks
 * the age of the last one; after two stale checks it kills the app.
 * Opening the app again picks up the interrupted runs.
 */
export function startWatchdog(
	options: { checkEveryMs?: number; staleAfterMs?: number } = {},
): { heartbeat(at: number): void; terminate(): void } {
	const worker = new Worker(new URL("./watchdog-worker.ts", import.meta.url));
	worker.postMessage({
		kind: "start",
		checkEveryMs: options.checkEveryMs ?? 15_000,
		staleAfterMs: options.staleAfterMs ?? HEALTH_STALE_AFTER_MS,
	} satisfies WatchdogMessage);
	return {
		heartbeat: (at) =>
			worker.postMessage({ kind: "heartbeat", at } satisfies WatchdogMessage),
		terminate: () => worker.terminate(),
	};
}
