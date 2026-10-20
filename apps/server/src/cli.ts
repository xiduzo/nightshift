import { join } from "node:path";
import { hasLogin, hostPolicyFromEnv } from "@nightshift/auth";

import { prepareDaemonEnv } from "./daemon-env";
import { reachFor } from "./devices";
import { embedded, extractMigrations } from "./headless/embedded";
import { directoryWeb, embeddedWeb, webHandler } from "./headless/web";
import { healthCommand } from "./health-cli";
import { adminCommand, joinCommand, pairCommand } from "./join-cli";
import { guardProcess } from "./process-guard";
import { serveDaemon, tlsPortOf } from "./serve";
import { notifySystemd } from "./systemd";

/**
 * `nightshift`: Night Shift without a window, for a server or any computer
 * (`scripts/build-binary.ts` compiles it into one file). From source:
 * `bun src/cli.ts <command>`.
 */

const HELP = `Night Shift

Usage:
  nightshift serve [options]                Run Night Shift on this computer.
  nightshift join <host-address> [--guest]  Pair this computer with a Host.
  nightshift pair <code> [--yes]            Allow a computer to pair with this Host.
  nightshift admin --email <email>          Set how the Host admin signs in from
                                            another computer. --reset-two-factor
                                            also turns two-factor sign-in off.
  nightshift health [--restart]             Exit code 0 when Night Shift runs here, else 1.
                                            --restart stops a Night Shift that does not
                                            respond, so that its service manager starts it
                                            again. --data-dir as for serve.

Options of serve (each has an environment variable too):
  --port <port>            The port. PORT, default 3000.
  --data-dir <folder>      Where the database and the run history go. NIGHTSHIFT_DATA_DIR.
  --host-address <url>     Be a Host at this https:// address. Repeat it for each
                           address, in the order other computers try them.
                           NIGHTSHIFT_HOST_ADDRESSES (comma-separated).
  --listen <ip>            Where a Host listens. NIGHTSHIFT_LISTEN, default 0.0.0.0.
                           Use 127.0.0.1 behind Tailscale Serve, a tunnel or a proxy.
  --tls-port <port>        The https:// port with NIGHTSHIFT_TLS_CERT and _KEY.
                           NIGHTSHIFT_TLS_PORT, default the port + 443.
  --web <folder>           Serve the web UI from this folder. NIGHTSHIFT_WEB_DIR.
  --require-two-factor     People who sign in from another computer must use
                           two-factor sign-in. NIGHTSHIFT_REQUIRE_TWO_FACTOR=on.

The auth secret is BETTER_AUTH_SECRET, else the file BETTER_AUTH_SECRET_FILE,
else BETTER_AUTH_SECRET in NIGHTSHIFT_SECRETS_DIR or systemd's credentials,
else one Night Shift makes once in the data folder.
`;

export type ServeOptions = {
	port: number;
	tlsPort?: number;
	/** The environment to set before the server loads. */
	env: Record<string, string>;
	/** This daemon's own address: the first https:// Host address, else this computer. */
	url: string;
	web: string | null;
	/** People who sign in from another computer must use two-factor sign-in. */
	requireTwoFactor: boolean;
};

/** `serve`'s flags over the environment. Throws on a flag it does not know. */
export function serveOptions(
	argv: string[],
	env: Record<string, string | undefined>,
): ServeOptions {
	const args = [...argv];
	const set: Record<string, string> = {};
	const addresses: string[] = [];
	const value = (flag: string) => {
		const next = args.shift();
		if (!next) throw new Error(`${flag} needs a value.`);
		return next;
	};
	while (args.length > 0) {
		const flag = args.shift() as string;
		if (flag === "--port") set.PORT = value(flag);
		else if (flag === "--data-dir") set.NIGHTSHIFT_DATA_DIR = value(flag);
		else if (flag === "--host-address") addresses.push(value(flag));
		else if (flag === "--listen") set.NIGHTSHIFT_LISTEN = value(flag);
		else if (flag === "--tls-port") set.NIGHTSHIFT_TLS_PORT = value(flag);
		else if (flag === "--web") set.NIGHTSHIFT_WEB_DIR = value(flag);
		else if (flag === "--require-two-factor") {
			set.NIGHTSHIFT_REQUIRE_TWO_FACTOR = "on";
		} else throw new Error(`There is no option ${flag}.`);
	}
	if (addresses.length > 0) {
		set.NIGHTSHIFT_HOST = "on";
		set.NIGHTSHIFT_HOST_ADDRESSES = addresses.join(",");
	}
	const merged = { ...env, ...set };
	const port = Number(merged.PORT || 3000);
	if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
		throw new Error(`${merged.PORT} is not a port.`);
	}
	const https = (merged.NIGHTSHIFT_HOST_ADDRESSES ?? "")
		.split(",")
		.map((a) => a.trim())
		.find((a) => a.startsWith("https://"));
	return {
		port,
		tlsPort: tlsPortOf(merged.NIGHTSHIFT_TLS_PORT),
		env: set,
		url: https ? new URL(https).origin : `http://localhost:${port}`,
		web: merged.NIGHTSHIFT_WEB_DIR?.trim() || null,
		// Checked here too, so a typo stops `serve` before anything starts.
		requireTwoFactor: hostPolicyFromEnv(merged).requireTwoFactor,
	};
}

async function serve(argv: string[]) {
	// A service manager (systemd, Docker, launchd) starts it again.
	guardProcess({ exitOnUncaughtException: true });
	let options: ServeOptions;
	try {
		options = serveOptions(argv, process.env);
	} catch (error) {
		console.error(`${(error as Error).message}\n\n${HELP}`);
		process.exit(2);
	}
	Object.assign(process.env, options.env);
	// The UI is served here, so its address is this daemon's own.
	const { dataDir } = prepareDaemonEnv({
		port: options.port,
		url: options.url,
		uiOrigin: options.url,
	});

	const files = embedded();
	if (files)
		await extractMigrations(files.migrations, join(dataDir, "migrations"));

	// Imported only now: the server reads its environment and takes the
	// database lease when it loads. One after the other: Bun 1.3 can run
	// `./index` before `./services` it imports has finished loading, when
	// both are imported at once ("Cannot access 'serve' before
	// initialization").
	const { settings, db, daemon: self } = await import("./services");
	const { default: daemon } = await import("./index");
	const web = files
		? embeddedWeb(files.web)
		: options.web
			? directoryWeb(options.web)
			: null;
	const ui = web ? webHandler(web) : null;

	const servers = serveDaemon(daemon, {
		port: options.port,
		tlsPort: options.tlsPort,
		...(ui
			? {
					fetch: async (request, server) =>
						(await ui(request)) ?? daemon.fetch(request, server),
				}
			: {}),
	});
	for (const server of servers) {
		console.log(`Night Shift answers at ${server.url}`);
	}
	// Under systemd: started, and the watchdog's pings.
	notifySystemd();
	console.log(`Data folder: ${dataDir}`);
	if (reachFor(settings.current()) === "this-computer") {
		console.log(
			"Only this computer can connect. To let other computers pair with it, be a Host: --host-address https://…",
		);
	} else if (!(await hasLogin(db, self.device.ownerId))) {
		// A fresh Host: its admin signs in for nothing here, and has no
		// sign-in for a browser elsewhere yet.
		console.log(
			"To sign in from a browser on another computer, set the Host admin's sign-in here first: nightshift admin --email you@example.com",
		);
	}
	if (options.requireTwoFactor) {
		console.log(
			"Two-factor sign-in is required for people who sign in from another computer.",
		);
	}
	if (!ui) console.log("No web UI here: run it with --web <folder>.");
}

export async function main(argv: string[]) {
	const [command, ...rest] = argv;
	switch (command) {
		case "serve":
			return serve(rest);
		case "join":
			return joinCommand(rest, "nightshift join");
		case "pair":
			return pairCommand(rest, "nightshift pair");
		case "admin":
			return adminCommand(rest, "nightshift admin");
		case "health":
			return healthCommand(rest, "nightshift health");
		case undefined:
		case "help":
		case "--help":
		case "-h":
			console.log(HELP);
			return;
		default:
			console.error(`There is no command ${command}.\n\n${HELP}`);
			process.exit(2);
	}
}

if (import.meta.main) await main(process.argv.slice(2));
