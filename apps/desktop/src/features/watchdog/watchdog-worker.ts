/**
 * The desktop app's watchdog, in a Worker: see `./watchdog.ts`. A Worker has
 * its own event loop and timers, so it keeps checking when the app's own
 * timers stopped. The app's build bundles this file on its own and puts it
 * next to the app's bundle (`electrobun.config.ts`).
 *
 * It never opens the database. The daemon's libsql and a second SQLite in
 * this Worker would share one process without seeing each other's locks:
 * the Worker's connection could reset the daemon's shared-memory file under
 * it, and the daemon crashed with a SIGBUS. The daemon tells it of each
 * lease heartbeat instead.
 */
import { now } from "@nightshift/time";

export type WatchdogMessage =
	| { kind: "start"; checkEveryMs: number; staleAfterMs: number }
	/** The daemon's lease heartbeat, which the database took at `at`. */
	| { kind: "heartbeat"; at: number };

declare const self: Worker;

let lastHeartbeatAt = now();
let started = false;

self.onmessage = (event: MessageEvent<WatchdogMessage>) => {
	const message = event.data;
	if (message.kind === "heartbeat") {
		lastHeartbeatAt = Math.max(lastHeartbeatAt, message.at);
		return;
	}
	if (started) return;
	started = true;
	lastHeartbeatAt = now();
	let staleReads = 0;
	setInterval(() => {
		const age = now() - lastHeartbeatAt;
		// Twice in a row: a computer that just woke from sleep catches up.
		staleReads = age > message.staleAfterMs ? staleReads + 1 : 0;
		if (staleReads < 2) return;
		console.error(
			`WATCHDOG: the daemon's last heartbeat is ${Math.round(age / 1_000)} s old. Its timers stopped, or it hangs. Killing the app: open it again to pick up the runs.`,
		);
		process.kill(process.pid, "SIGKILL");
	}, message.checkEveryMs);
};
