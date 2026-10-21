/**
 * Run by `process-guard.test.ts` under `bun --hot`: an error nothing
 * catches, then a timer. It prints "timers alive" when the timer still
 * fires. GUARD=log or GUARD=exit registers the handlers first. ERROR is
 * "rejection" or "exception".
 */
import { guardProcess } from "../process-guard";

if (process.env.GUARD) {
	guardProcess({ exitOnUncaughtException: process.env.GUARD === "exit" });
}

setTimeout(() => {
	if (process.env.ERROR === "exception") throw new Error("boom");
	void Promise.reject(new Error("boom"));
}, 50);

setTimeout(() => {
	console.log("timers alive");
	process.exit(0);
}, 400);
