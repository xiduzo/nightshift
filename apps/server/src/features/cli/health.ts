import { join } from "node:path";

import { checkHealth } from "@nightshift/daemon";
import {
	DATABASE_FILE,
	databaseUrl,
	resolveDataDir,
} from "@nightshift/db/data-dir";

import { readArgs, required, turnOn } from "./args";
import { command } from "./command";

/**
 * `nightshift health`: whether Night Shift runs on this data folder. It
 * reads the database itself, so it answers when HTTP does not, and the
 * container image needs no curl. Exit code 0: it runs. 1: it does not.
 *
 * `--restart` stops a Night Shift that does not respond, so that its
 * service manager (launchd, systemd) starts it again. It checks twice,
 * 15 s apart first: a computer that just woke from sleep gets one
 * heartbeat to catch up.
 */

/** The options of `nightshift health` over the environment. */
function healthOptions(argv: readonly string[]) {
	const options = { dataDir: process.env.NIGHTSHIFT_DATA_DIR, restart: false };
	readArgs(argv, {
		flags: { "--restart": turnOn(options, "restart") },
		values: {
			"--data-dir": required((folder) => {
				options.dataDir = folder;
			}),
		},
	});
	return options;
}

export const healthCommand = command({
	name: "health",
	help: `  nightshift health [--restart]             Exit code 0 when Night Shift runs here, else 1.
                                            --restart stops a Night Shift that does not
                                            respond, so that its service manager starts it
                                            again. --data-dir as for serve.`,
	usage: (program) =>
		`Usage: ${program} [--data-dir <folder>] [--restart]\nExit code 0 when Night Shift runs on this data folder, else 1.\n--restart stops a Night Shift that does not respond, so that its service manager starts it again.`,
	options: healthOptions,
	run: async ({ dataDir, restart }) => {
		const dir = resolveDataDir({
			NIGHTSHIFT_DATA_DIR: dataDir,
			NIGHTSHIFT_DEV: process.env.NIGHTSHIFT_DEV === "true",
		});
		const url = databaseUrl({ DATABASE_URL: process.env.DATABASE_URL }, dir);
		try {
			process.exit(await checkHealth({ url, restart }));
		} catch (error) {
			console.error(
				`The database in ${url.startsWith("file:") ? join(dir, DATABASE_FILE) : "DATABASE_URL"} cannot be read:`,
				error instanceof Error ? error.message : error,
			);
			process.exit(1);
		}
	},
});
