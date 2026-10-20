/**
 * Run by `watchdog.test.ts` under `bun --hot`, as the app's daemon whose
 * timers died: an unhandled rejection with no handler stops this thread's
 * timers (the Bun bug). The watchdog Worker should still kill it. It prints
 * "main timers alive" if its own timers still fire.
 */
import { startWatchdog } from "../watchdog";

const [database, owner] = process.argv.slice(2) as [string, string];
startWatchdog({ database, owner, checkEveryMs: 100, staleAfterMs: 1_000 });

setTimeout(() => {
	void Promise.reject(new Error("boom"));
}, 50);
setInterval(() => console.log("main timers alive"), 300);
