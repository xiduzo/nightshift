import { hot } from "./hot";

/** How long a clean stop may take before the process exits anyway. */
export const STOP_WITHIN_MS = 2_000;

/**
 * Runs `stop`, bounded by STOP_WITHIN_MS. The bound is a timer, and dead
 * timers never fire it. The writes of a stop need no timer, so a stop
 * still ends when they do. Never throws.
 */
async function boundedStop(stop: () => Promise<unknown>): Promise<void> {
	await Promise.race([stop(), Bun.sleep(STOP_WITHIN_MS)]).catch(() => {});
}

/** How long a start waits for the stop before it before it says so. */
const STOP_WAIT_SAID_AFTER_MS = 3_000;

/**
 * The stop of a daemon's slots, bounded by STOP_WITHIN_MS. What the bound
 * cut goes on in `hot.nightshiftStopping`, after any stop before it: a
 * second stop never ends the slots while the first still stops them.
 */
export function lastingStop(
	stopSlots: () => Promise<void>,
): () => Promise<void> {
	return () =>
		boundedStop(() => {
			const before = hot.nightshiftStopping ?? Promise.resolve();
			hot.nightshiftStopping = before.then(stopSlots);
			return hot.nightshiftStopping;
		});
}

/**
 * Waits until every stop of this process ended: a stop that gave up at its
 * bound still ends the slots by name, the lease too. Says so once when it
 * waits long.
 */
export async function afterStops(): Promise<void> {
	const stopping = hot.nightshiftStopping;
	if (!stopping) return;
	const said = setTimeout(() => {
		console.log(
			"Night Shift waits until the Night Shift before it has stopped.",
		);
	}, STOP_WAIT_SAID_AFTER_MS);
	try {
		await stopping;
	} finally {
		clearTimeout(said);
	}
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
