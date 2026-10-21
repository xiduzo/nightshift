/**
 * The desktop app's watchdog, in a Worker: see `./watchdog.ts`. A Worker has
 * its own event loop and timers, so it keeps checking when the app's own
 * timers stopped. This file runs as it is, next to the app's bundle
 * (`electrobun.config.ts` copies it): it imports nothing but Bun.
 */
import { Database } from "bun:sqlite";

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
		const db = new Database(start.database, { readonly: true });
		try {
			const row = db
				.query<{ owner: string | null; heartbeatAt: number }, []>(
					"SELECT owner, heartbeat_at AS heartbeatAt FROM daemon_lease WHERE id = 1",
				)
				.get();
			return row?.owner === start.owner ? Date.now() - row.heartbeatAt : null;
		} finally {
			db.close();
		}
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
