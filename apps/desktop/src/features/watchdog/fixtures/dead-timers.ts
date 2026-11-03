/**
 * Run by `watchdog.test.ts` under `bun --hot`, as the app's daemon. It sends
 * a heartbeat every 100 ms from this thread's timers. With `die`, an
 * unhandled rejection with no handler stops those timers (the Bun bug), so
 * the heartbeats stop: the watchdog Worker should kill it. It prints "main
 * timers alive" if its own timers still fire.
 */
import { now } from "@nightshift/time";
import { startWatchdog } from "../watchdog";

const die = process.argv[2] === "die";
const watchdog = startWatchdog({ checkEveryMs: 100, staleAfterMs: 1_000 });
setInterval(() => watchdog.heartbeat(now()), 100);

if (die) {
	setTimeout(() => {
		void Promise.reject(new Error("boom"));
	}, 50);
}
setInterval(() => console.log("main timers alive"), 300);
