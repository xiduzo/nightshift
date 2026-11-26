/**
 * The dev entry: `bun run dev` runs it under `bun --hot`, and `bun run
 * night` and the multi-daemon tests run it with plain `bun`. varlock loads
 * `apps/server/.env` and checks it against `.env.schema` first.
 *
 * Under `bun --hot` every save evaluates this file again, in the same
 * process: `startDaemon` hands the lease, the documents and the listeners
 * over to the new daemon, and the engine before it lets go of its runs.
 *
 * When it cannot listen (its port is taken, or its address is not this
 * computer's), the process says why and exits with code 1: `bun run
 * night` then stops too. A first start that refuses exits the same way. A
 * reload that refuses keeps the daemon before it, as any other error does.
 */
import "varlock/auto-load";

import { daemonPort, ListenError, startDaemon } from "@nightshift/daemon";
import { Refusal } from "@nightshift/refusal";

import { ENV } from "./env";

/** Set once a daemon of this process started: a later evaluation is a reload. */
const entry = globalThis as { nightshiftDevEntryStarted?: true };
const reload = entry.nightshiftDevEntryStarted === true;

try {
	await startDaemon({
		env: ENV,
		port: daemonPort(),
		// One listener on PORT, as before: `bun run night` asks it for /health.
		oneListener: true,
		// Notifications on this computer's desktop, through the OS programs.
		desktop: "system",
	});
	entry.nightshiftDevEntryStarted = true;
} catch (error) {
	// It cannot listen, or its first start refuses (a refusal has words for
	// the person): say why and exit. Any other error, and a refusal of a
	// reload, goes to the process guard: the daemon before keeps running.
	const refused = error instanceof Refusal && !reload;
	if (!(error instanceof ListenError || refused)) throw error;
	console.error(error.message);
	process.exit(1);
}
