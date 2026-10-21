/**
 * The dev entry: `bun run dev` runs it under `bun --hot`, and `bun run
 * night` and the multi-daemon tests run it with plain `bun`. varlock loads
 * `apps/server/.env` and checks it against `.env.schema` first.
 *
 * Under `bun --hot` every save evaluates this file again, in the same
 * process: `startDaemon` hands the lease, the documents and the listeners
 * over to the new daemon, and the engine before it lets go of its runs.
 */
import "varlock/auto-load";

import { daemonPort, startDaemon } from "@nightshift/daemon";

import { ENV } from "./env";

await startDaemon({
	env: ENV,
	port: daemonPort(),
	// One listener on PORT, as before: `bun run night` asks it for /health.
	oneListener: true,
});
