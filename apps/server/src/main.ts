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
 * computer's), the daemon stops and the process exits with code 1:
 * `bun run night` then stops too, and says why.
 */
import "varlock/auto-load";

import { daemonPort, ListenError, startDaemon } from "@nightshift/daemon";

import { ENV } from "./env";

try {
	await startDaemon({
		env: ENV,
		port: daemonPort(),
		// One listener on PORT, as before: `bun run night` asks it for /health.
		oneListener: true,
		// Notifications on this computer's desktop, through the OS programs.
		desktop: "system",
	});
} catch (error) {
	// The daemon already stopped: say why and exit. Any other error goes
	// to the process guard, as before.
	if (!(error instanceof ListenError)) throw error;
	console.error(error.message);
	process.exit(1);
}
