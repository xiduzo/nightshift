import { hot } from "./hot";

/** How long a clean stop may take before the process exits anyway. */
export const STOP_WITHIN_MS = 2_000;

/**
 * Runs `stop`, bounded by STOP_WITHIN_MS. The bound is a timer, and dead
 * timers never fire it. The writes of a stop need no timer, so a stop
 * still ends when they do. Never throws.
 */
export async function boundedStop(stop: () => Promise<unknown>): Promise<void> {
	await Promise.race([stop(), Bun.sleep(STOP_WITHIN_MS)]).catch(() => {});
}

/**
 * SIGINT, SIGTERM and SIGHUP stop the newest daemon of this process, then
 * exit with code 0. Registered once per process: `bun --hot` reloads only
 * swap the stop they call. If the stop hangs, a second signal stops the
 * process at once (`once`: the default action is back), and every watchdog
 * sends SIGKILL a few seconds after SIGTERM.
 */
export function stopOnSignals(stop: () => Promise<void>): void {
	const registered = hot.nightshiftStop !== undefined;
	hot.nightshiftStop = stop;
	if (registered) return;
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		process.once(signal, () => {
			void (hot.nightshiftStop?.() ?? Promise.resolve())
				.catch(() => {})
				.finally(() => process.exit(0));
		});
	}
}
