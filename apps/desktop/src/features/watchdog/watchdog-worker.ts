/**
 * The desktop app's watchdog, in a Worker: see `./watchdog.ts`. A Worker has
 * its own event loop and timers, so it keeps checking when the app's own
 * timers stopped. The app's build bundles this file on its own and puts it
 * next to the app's bundle (`electrobun.config.ts`). It imports only the
 * heartbeat read of `@nightshift/daemon`, an entry that loads nothing else.
 */
import { readHeartbeatFile } from "@nightshift/daemon/heartbeat";
import { now } from "@nightshift/time";

export type WatchdogStart = {
	/** The database file. */
	database: string;
	/** The lease this app's daemon holds. */
	owner: string;
	checkEveryMs: number;
	staleAfterMs: number;
};

declare const self: Worker;

/**
 * How old this daemon's lease heartbeat is (the health check of `@nightshift/daemon` reads
 * the same row). Null when there is nothing to judge: the lease was given
 * up (the app is quitting), or another daemon holds it.
 */
function heartbeatAge(start: WatchdogStart): number | null {
	try {
		const row = readHeartbeatFile(start.database);
		return row?.owner === start.owner ? now() - row.heartbeatAt : null;
	} catch (error) {
		console.error("The watchdog could not read the database:", error);
		return null;
	}
}

self.onmessage = (event: MessageEvent<WatchdogStart>) => {
	const start = event.data;
	let staleReads = 0;
	setInterval(() => {
		const age = heartbeatAge(start);
		// Twice in a row: a computer that just woke from sleep catches up.
		staleReads = age !== null && age > start.staleAfterMs ? staleReads + 1 : 0;
		if (staleReads < 2) return;
		console.error(
			`WATCHDOG: the daemon's last heartbeat is ${Math.round((age ?? 0) / 1_000)} s old. Its timers stopped, or it hangs. Killing the app: open it again to pick up the runs.`,
		);
		process.kill(process.pid, "SIGKILL");
	}, start.checkEveryMs);
};
