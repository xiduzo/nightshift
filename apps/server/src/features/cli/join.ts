import type { AppRouterClient } from "@nightshift/api";
import { DEFAULT_PORT } from "@nightshift/daemon";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

/**
 * `nightshift join <host-url> [--guest]` (from source: `bun run join`):
 * pairs this computer with a Host. Night Shift must run on this computer:
 * it does the pairing and keeps the link (`devices.join`). This prints the
 * code to approve on the Host and waits until the Host answers.
 *
 * `--guest`: the Host gets this computer's shared Spaces only, never its
 * own settings. `--daemon <url>`: where Night Shift runs on this computer
 * (default http://localhost:$PORT, else the default port).
 *
 * `nightshift pair <code>`: approves a code on this computer, when it is
 * the Host: for a Host without a screen (a server, a container).
 */

/** Night Shift on this computer: plain http on the loopback, also when it serves https:// to others. */
export function defaultDaemonUrl(): string {
	return (
		process.env.NIGHTSHIFT_DAEMON_URL ??
		`http://localhost:${process.env.PORT || DEFAULT_PORT}`
	);
}

/** The procedures of Night Shift on this computer, once it answers. Exits when it does not. */
async function daemonClient(daemon: string): Promise<AppRouterClient> {
	const client: AppRouterClient = createORPCClient(
		new RPCLink({ url: `${daemon.replace(/\/$/, "")}/rpc` }),
	);
	try {
		await client.healthCheck();
	} catch {
		console.error(
			`Night Shift does not run on this computer (${daemon}). Start it first.`,
		);
		process.exit(1);
	}
	return client;
}

function parseJoin(argv: string[]) {
	const args = [...argv];
	let url: string | null = null;
	let role: "home" | "guest" = "home";
	let daemon = defaultDaemonUrl();
	while (args.length > 0) {
		const arg = args.shift() as string;
		if (arg === "--guest") role = "guest";
		else if (arg === "--daemon") daemon = args.shift() ?? daemon;
		else if (arg === "--help" || arg === "-h") return null;
		else url = arg;
	}
	return url ? { url, role, daemon } : null;
}

export async function joinCommand(argv: string[], program: string) {
	const options = parseJoin(argv);
	if (!options) {
		console.log(
			`Usage: ${program} <host-address> [--guest] [--daemon <address>]\nExample: ${program} https://studio.example.com`,
		);
		process.exit(2);
	}
	const client = await daemonClient(options.daemon);

	const stop = new AbortController();
	process.once("SIGINT", () => stop.abort());
	try {
		const progress = await client.devices.join(
			{ url: options.url, role: options.role },
			{ signal: stop.signal },
		);
		for await (const step of progress) {
			if (step.kind === "code") {
				const code = `${step.userCode.slice(0, 4)}-${step.userCode.slice(4)}`;
				console.log(
					[
						"",
						"To pair this computer, open Night Shift on the Host, go to Devices, choose Pair a device, and enter this code:",
						"",
						`    ${code}`,
						...(step.verificationUriComplete
							? ["", `Or open ${step.verificationUriComplete}`]
							: []),
						"",
						"On a Host without a screen, run this on the Host instead:",
						`    nightshift pair ${code}`,
						...(step.fingerprint
							? [
									"",
									"The Host uses its own certificate. Check that its Devices page shows this fingerprint:",
									`    ${step.fingerprint}`,
								]
							: []),
						"",
						`The code works until ${new Date(step.expiresAt).toLocaleTimeString()}. Waiting for the Host…`,
					].join("\n"),
				);
			} else {
				console.log(
					`\nPaired with ${step.hostName} as ${step.role === "home" ? "its home Host" : "a guest Host"}. This computer stays connected to it.`,
				);
			}
		}
	} catch (error) {
		if (stop.signal.aborted) {
			console.error("\nPairing stopped.");
			process.exit(130);
		}
		console.error(`\n${error instanceof Error ? error.message : error}`);
		process.exit(1);
	}
}

export async function pairCommand(argv: string[], program: string) {
	const args = [...argv];
	let code: string | null = null;
	let yes = false;
	let daemon = defaultDaemonUrl();
	while (args.length > 0) {
		const arg = args.shift() as string;
		if (arg === "--yes" || arg === "-y") yes = true;
		else if (arg === "--daemon") daemon = args.shift() ?? daemon;
		else if (arg !== "--help" && arg !== "-h") code = arg;
	}
	if (!code) {
		console.log(
			`Usage: ${program} <code> [--yes] [--daemon <address>]\nRun it on the Host, with the code the other computer shows. Example: ${program} ABCD-EFGH`,
		);
		process.exit(2);
	}
	const userCode = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
	const client = await daemonClient(daemon);
	try {
		const review = await client.devices.review({ userCode });
		if (review.status !== "pending") {
			console.error("This code has an answer already.");
			process.exit(1);
		}
		const name = review.device.name ?? "A device";
		console.log(
			`${name}${review.device.platform ? ` (${review.device.platform})` : ""} wants to pair with this computer.`,
		);
		if (review.fingerprint) {
			console.log(
				`Allow it only when it shows this fingerprint:\n    ${review.fingerprint}`,
			);
		}
		if (!yes) {
			if (!process.stdin.isTTY) {
				console.error("Add --yes to allow it without a question.");
				process.exit(2);
			}
			if (!confirm("Allow it?")) {
				await client.devices.deny({ userCode });
				console.log("Declined.");
				return;
			}
		}
		await client.devices.approve({ userCode });
		console.log(`Allowed. ${name} syncs with this computer now.`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}

/**
 * `nightshift admin --email <email>`: gives this computer's owner, the Host
 * admin, an email and a password, to sign in from a browser on another
 * computer and invite others. Run it on the Host (over SSH, or with
 * `docker exec`). The password comes from a prompt that does not show it,
 * or from standard input with `--password-stdin`.
 */
export async function adminCommand(argv: string[], program: string) {
	const args = [...argv];
	let email: string | null = null;
	let name: string | undefined;
	let fromStdin = false;
	let resetTwoFactor = false;
	let daemon = defaultDaemonUrl();
	while (args.length > 0) {
		const arg = args.shift() as string;
		if (arg === "--email") email = args.shift() ?? null;
		else if (arg === "--name") name = args.shift();
		else if (arg === "--password-stdin") fromStdin = true;
		else if (arg === "--reset-two-factor") resetTwoFactor = true;
		else if (arg === "--daemon") daemon = args.shift() ?? daemon;
		else {
			email = null;
			break;
		}
	}
	if (!email) {
		console.log(
			`Usage: ${program} --email <email> [--name <name>] [--password-stdin] [--reset-two-factor]\nRun it on the Host. It sets the email and password the Host admin signs in with from another computer.\n--reset-two-factor also turns two-factor sign-in off, for a lost authenticator app.`,
		);
		process.exit(2);
	}
	const client = await daemonClient(daemon);
	const password = fromStdin
		? (await Bun.stdin.text()).replace(/\r?\n$/, "")
		: await hiddenPrompt("Password: ");
	try {
		const login = await client.account.setLogin({
			email,
			password,
			name,
			resetTwoFactor,
		});
		const hello = await client.devices.list();
		const address = hello.thisComputer?.host.addresses.find((a) =>
			a.startsWith("https://"),
		);
		console.log(
			`Done. Sign in as ${login.email}${address ? ` at ${address}/login` : ""}, then invite others from Members.`,
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}

/** Reads a line from the terminal without showing it. */
async function hiddenPrompt(question: string): Promise<string> {
	const stdin = process.stdin;
	if (!stdin.isTTY) {
		console.error(
			"Add --password-stdin to give the password without a terminal.",
		);
		process.exit(2);
	}
	process.stdout.write(question);
	stdin.setRawMode(true);
	stdin.resume();
	let value = "";
	return new Promise((resolve) => {
		const onData = (chunk: Buffer) => {
			for (const char of chunk.toString("utf8")) {
				if (char === "\r" || char === "\n") {
					stdin.setRawMode(false);
					stdin.pause();
					stdin.off("data", onData);
					process.stdout.write("\n");
					resolve(value);
					return;
				}
				if (char === "\u0003") process.exit(130);
				if (char === "\u007f") value = value.slice(0, -1);
				else value += char;
			}
		};
		stdin.on("data", onData);
	});
}
