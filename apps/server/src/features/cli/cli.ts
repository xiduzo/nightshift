import { join } from "node:path";
import { hostPolicyFromEnv } from "@nightshift/auth";
import {
	type DaemonEnv,
	DEFAULT_PORT,
	directoryWeb,
	embeddedWeb,
	guardProcess,
	ListenError,
	portOf,
	prepareDaemonEnv,
	startDaemon,
	webHandler,
} from "@nightshift/daemon";
import { parseListen } from "@nightshift/devices";
import { Refusal } from "@nightshift/refusal";

import { BadArguments, needsValue, readArgs, required } from "./args";
import { type Command, command } from "./command";
import {
	embedded,
	embeddedPiAcp,
	extractMigrations,
	PI_ACP_COMMAND,
} from "./embedded";
import { flowsCommand } from "./flows";
import { healthCommand } from "./health";
import { adminCommand, joinCommand, pairCommand } from "./join";
import { leaveCommand } from "./leave";
import { mcpCommand } from "./mcp";
import { mergeCommand } from "./merge";

/**
 * `nightshift`: Night Shift without a window, for a server or any computer
 * (`scripts/build-binary.ts` compiles it into one file). From source:
 * `bun src/cli.ts <command>`.
 */

/** The commands, in the order of the help. */
const COMMANDS: Command[] = [
	command({
		name: "serve",
		help: "  nightshift serve [options]                Run Night Shift on this computer.",
		usage: help,
		options: (argv) => serveOptions(argv, process.env),
		run: serve,
	}),
	joinCommand,
	pairCommand,
	mergeCommand,
	leaveCommand,
	adminCommand,
	mcpCommand,
	flowsCommand,
	healthCommand,
	{
		name: PI_ACP_COMMAND,
		// The pi harness of the binary starts it (embeddedPiAcp).
		help: null,
		run: async () => {
			const { runPiAcp } = await import("@nightshift/agents");
			return runPiAcp();
		},
	},
];

function help(): string {
	return `Night Shift

Usage:
${COMMANDS.flatMap((each) => each.help ?? []).join("\n")}

Options of serve (each has an environment variable too):
  --port <port>            The port. PORT, default ${DEFAULT_PORT}.
  --data-dir <folder>      Where the database and the run history go. NIGHTSHIFT_DATA_DIR.
  --host-address <url>     Be a Host at this https:// address. Repeat it for each
                           address, in the order other computers try them.
                           NIGHTSHIFT_HOST_ADDRESSES (comma-separated).
  --listen <address>       Where a Host listens: an IP address or a host name.
                           NIGHTSHIFT_LISTEN, default 0.0.0.0. Use 127.0.0.1
                           behind Tailscale Serve, a tunnel or a proxy.
  --tls-port <port>        The https:// port with NIGHTSHIFT_TLS_CERT and _KEY.
                           NIGHTSHIFT_TLS_PORT, default the port + 443.
  --web <folder>           Serve the web UI from this folder. NIGHTSHIFT_WEB_DIR.
  --require-two-factor     People who sign in from another computer must use
                           two-factor sign-in. NIGHTSHIFT_REQUIRE_TWO_FACTOR=on.

The auth secret is BETTER_AUTH_SECRET, else the file BETTER_AUTH_SECRET_FILE,
else BETTER_AUTH_SECRET in NIGHTSHIFT_SECRETS_DIR or systemd's credentials,
else one Night Shift makes once in the data folder.
`;
}

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
	const set: Record<string, string> = {};
	const addresses: string[] = [];
	const value = (to: (value: string) => void) => required(to, needsValue);
	const variable = (name: string) =>
		value((text) => {
			set[name] = text;
		});
	readArgs(argv, {
		flags: {
			"--require-two-factor": () => {
				set.NIGHTSHIFT_REQUIRE_TWO_FACTOR = "on";
			},
		},
		values: {
			"--port": variable("PORT"),
			"--data-dir": variable("NIGHTSHIFT_DATA_DIR"),
			"--host-address": value((address) => {
				addresses.push(address);
			}),
			"--listen": variable("NIGHTSHIFT_LISTEN"),
			"--tls-port": variable("NIGHTSHIFT_TLS_PORT"),
			"--web": variable("NIGHTSHIFT_WEB_DIR"),
		},
		other: (arg) => {
			throw new BadArguments(`There is no option ${arg}.`);
		},
	});
	if (addresses.length > 0) {
		set.NIGHTSHIFT_HOST = "on";
		set.NIGHTSHIFT_HOST_ADDRESSES = addresses.join(",");
	}
	const merged = { ...env, ...set };
	const asPort = (text: string) => {
		const port = portOf(text);
		// Checked here, so a typo stops `serve` before anything starts.
		if (port === undefined) throw new BadArguments(`${text} is not a port.`);
		return port;
	};
	const port = merged.PORT ? asPort(merged.PORT) : DEFAULT_PORT;
	// Checked here too, so a typo stops `serve` before anything starts.
	parseListen(merged.NIGHTSHIFT_LISTEN);
	const https = (merged.NIGHTSHIFT_HOST_ADDRESSES ?? "")
		.split(",")
		.map((a) => a.trim())
		.find((a) => a.startsWith("https://"));
	return {
		port,
		tlsPort: merged.NIGHTSHIFT_TLS_PORT
			? asPort(merged.NIGHTSHIFT_TLS_PORT)
			: undefined,
		env: set,
		url: https ? new URL(https).origin : `http://localhost:${port}`,
		web: merged.NIGHTSHIFT_WEB_DIR?.trim() || null,
		// Checked here too, so a typo stops `serve` before anything starts.
		requireTwoFactor: hostPolicyFromEnv(merged).requireTwoFactor,
	};
}

async function serve(options: ServeOptions): Promise<undefined> {
	// A service manager (systemd, Docker, launchd) starts it again.
	guardProcess({ exitOnUncaughtException: true });
	Object.assign(process.env, options.env);
	// The UI is served here, so its address is this daemon's own.
	const { dataDir } = prepareDaemonEnv({
		port: options.port,
		url: options.url,
		uiOrigin: options.url,
	});

	const files = embedded();
	const migrationsFolder = files
		? await extractMigrations(files.migrations, join(dataDir, "migrations"))
		: undefined;

	const web = files
		? embeddedWeb(files.web)
		: options.web
			? directoryWeb(options.web)
			: null;
	const ui = web ? webHandler(web) : null;

	const daemon = await startDaemon({
		env: await daemonEnv(),
		port: options.port,
		tlsPort: options.tlsPort,
		piAcp: embeddedPiAcp(),
		migrationsFolder,
		// Notifications on this computer's desktop, where it has one.
		desktop: "system",
		...(ui ? { web: ui } : {}),
	}).catch((error: unknown) => {
		// The daemon already stopped. Exit with code 1, as the process guard
		// does, with the message only: a refusal has words for the person too.
		if (!(error instanceof ListenError || error instanceof Refusal)) {
			throw error;
		}
		console.error(error.message);
		process.exit(1);
	});
	if (daemon.info.reach === "this-computer") {
		console.log(
			"Only this computer can connect. To let other computers pair with it, be a Host: --host-address https://…",
		);
	} else if (!(await daemon.ownerHasLogin())) {
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

/**
 * The environment, read only now that `prepareDaemonEnv` filled it: from
 * source, varlock loads `apps/server/.env` under it and checks it (a value
 * already set wins). The `nightshift` binary swaps varlock for
 * `process.env` (`scripts/shims/`).
 */
async function daemonEnv(): Promise<DaemonEnv> {
	await import("varlock/auto-load");
	const { ENV } = await import("../../env");
	return ENV;
}

export async function main(argv: string[]) {
	const [name, ...rest] = argv;
	if (name === undefined || ["help", "--help", "-h"].includes(name)) {
		console.log(help());
		return;
	}
	const named = COMMANDS.find((each) => each.name === name);
	if (!named) {
		console.error(`There is no command ${name}.\n\n${help()}`);
		process.exit(2);
	}
	return named.run(rest, `nightshift ${name}`);
}
