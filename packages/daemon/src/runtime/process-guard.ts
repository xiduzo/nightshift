/**
 * What the daemon does with an error that nothing caught.
 *
 * Without a handler, Bun under `bun --hot` or `--watch` stops every
 * `setTimeout` and `setInterval` after one unhandled rejection or uncaught
 * exception, while HTTP keeps answering (https://github.com/oven-sh/bun/pull/38206).
 * The lease heartbeat, the scheduler and the run deadlines all stop with
 * them. With a handler the timers go on. Under plain `bun`, the process
 * exits instead.
 *
 * - An unhandled rejection is logged, and the daemon keeps running.
 * - An uncaught exception is logged. A daemon under a service manager
 *   (`nightshift serve`) then exits with code 1, and the service manager
 *   starts it again. In dev and in the desktop app it keeps running.
 */

type Guard = { exitOnUncaughtException: boolean };

// Kept across `bun --hot` reloads: the handlers are registered once.
const installed = globalThis as { nightshiftGuard?: Guard };

/**
 * Registers the handlers, once per process. A later call can only turn
 * `exitOnUncaughtException` on or off.
 */
export function guardProcess(
	options: { exitOnUncaughtException?: boolean } = {},
): void {
	let guard = installed.nightshiftGuard;
	if (!guard) {
		const created: Guard = { exitOnUncaughtException: false };
		process.on("unhandledRejection", (reason) => {
			console.error(
				"UNHANDLED REJECTION: a promise failed and nothing handled it. Night Shift keeps running.",
				reason,
			);
		});
		process.on("uncaughtException", (error) => {
			if (created.exitOnUncaughtException) {
				console.error("UNCAUGHT EXCEPTION: exiting with code 1.", error);
				process.exit(1);
			}
			console.error(
				"UNCAUGHT EXCEPTION: nothing caught this error. Night Shift keeps running.",
				error,
			);
		});
		installed.nightshiftGuard = created;
		guard = created;
	}
	if (options.exitOnUncaughtException !== undefined) {
		guard.exitOnUncaughtException = options.exitOnUncaughtException;
	}
}
