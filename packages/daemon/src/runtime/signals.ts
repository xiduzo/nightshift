import { constants } from "node:os";
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
 * swap the stops they call. `stopNow` runs before each exit: it kills at
 * once what must not outlive the process (the `ollama serve` Night Shift
 * started), also when the stop gave up at its bound. A second signal does
 * not wait for the stop: it runs `stopNow` and exits with 128 + the
 * signal's number, as the signal itself would. Every watchdog also sends
 * SIGKILL a few seconds after SIGTERM.
 */
export function stopOnSignals(
	stop: () => Promise<void>,
	stopNow: () => void,
): void {
	const registered = hot.nightshiftStop !== undefined;
	hot.nightshiftStop = stop;
	hot.nightshiftStopNow = stopNow;
	if (registered) return;
	const exit = (code: number) => {
		try {
			hot.nightshiftStopNow?.();
		} finally {
			process.exit(code);
		}
	};
	let stopping = false;
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		process.on(signal, () => {
			if (stopping) return exit(128 + constants.signals[signal]);
			stopping = true;
			void (hot.nightshiftStop?.() ?? Promise.resolve())
				.catch(() => {})
				.finally(() => exit(0));
		});
	}
}
