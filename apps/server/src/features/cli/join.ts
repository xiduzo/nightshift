import { formatTime } from "@nightshift/time";

import { BadArguments, keep, readArgs, turnOn } from "./args";
import { agrees, daemonCommand, defaultDaemonUrl } from "./command";
import { previewLines, resultLines } from "./merge-words";

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

function joinOptions(argv: readonly string[]) {
	const options: { url: string; role: "home" | "guest"; daemon: string } = {
		url: "",
		role: "home",
		daemon: defaultDaemonUrl(),
	};
	const usage = () => {
		throw new BadArguments();
	};
	readArgs(argv, {
		flags: {
			"--guest": () => {
				options.role = "guest";
			},
			"--help": usage,
			"-h": usage,
		},
		values: {
			"--daemon": keep(options, "daemon"),
		},
		other: (arg) => {
			options.url = arg;
		},
	});
	if (!options.url) throw new BadArguments();
	return options;
}

export const joinCommand = daemonCommand({
	name: "join",
	help: "  nightshift join <host-address> [--guest]  Pair this computer with a Host.",
	usage: (program) =>
		`Usage: ${program} <host-address> [--guest] [--daemon <address>]\nExample: ${program} https://studio.example.com`,
	options: joinOptions,
	run: async (client, { url, role }) => {
		const stop = new AbortController();
		process.once("SIGINT", () => stop.abort());
		try {
			const progress = await client.devices.join(
				{ url, role },
				{ signal: stop.signal },
			);
			let hostName = "your home Host";
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
							`The code works until ${formatTime(step.expiresAt)}. Waiting for the Host…`,
						].join("\n"),
					);
				} else if (step.kind === "merge-preview") {
					hostName = step.preview.host.name;
					console.log(`\n${previewLines(step.preview).join("\n")}`);
				} else if (step.kind === "merged") {
					console.log(`\n${resultLines(step.result, hostName).join("\n")}`);
				} else if (step.kind === "merge-skipped") {
					console.log(
						`\nYour Personal was not merged: ${step.reason}\nMerge it later from the Devices page of Night Shift.`,
					);
				} else {
					hostName = step.hostName;
					console.log(
						`\nPaired with ${step.hostName} as ${step.role === "home" ? "its home Host" : "a guest Host"}. This computer stays connected to it.`,
					);
					if (step.restart) {
						console.log(
							`${step.hostName} already knows this computer. Restart Night Shift to finish.`,
						);
					}
					if (step.role === "home" && step.hostAdmin === false) {
						console.log(
							`You are not the Host admin of ${step.hostName}. Its Host admin can read your personal runs and their transcripts there.`,
						);
					}
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
	},
});

function pairOptions(argv: readonly string[]) {
	const options = { code: "", yes: false, daemon: defaultDaemonUrl() };
	const allow = turnOn(options, "yes");
	// Without a code, `--help` shows the usage as any mistake does.
	const usage = () => {};
	readArgs(argv, {
		flags: { "--yes": allow, "-y": allow, "--help": usage, "-h": usage },
		values: {
			"--daemon": keep(options, "daemon"),
		},
		other: (arg) => {
			options.code = arg;
		},
	});
	if (!options.code) throw new BadArguments();
	return options;
}

export const pairCommand = daemonCommand({
	name: "pair",
	help: "  nightshift pair <code> [--yes]            Allow a computer to pair with this Host.",
	usage: (program) =>
		`Usage: ${program} <code> [--yes] [--daemon <address>]\nRun it on the Host, with the code the other computer shows. Example: ${program} ABCD-EFGH`,
	options: pairOptions,
	run: async (client, { code, yes }) => {
		const userCode = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
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
		const agreed = agrees(yes, {
			question: "Allow it?",
			needsYes: "Add --yes to allow it without a question.",
		});
		if (!agreed) {
			await client.devices.deny({ userCode });
			console.log("Declined.");
			return;
		}
		await client.devices.approve({ userCode });
		console.log(`Allowed. ${name} syncs with this computer now.`);
	},
});

/**
 * `nightshift admin --email <email>`: gives this computer's owner, the Host
 * admin, an email and a password, to sign in from a browser on another
 * computer and invite others. Run it on the Host (over SSH, or with
 * `docker exec`). The password comes from a prompt that does not show it,
 * or from standard input with `--password-stdin`.
 */
function adminOptions(argv: readonly string[]) {
	const options: {
		email: string;
		name?: string;
		fromStdin: boolean;
		resetTwoFactor: boolean;
		daemon: string;
	} = {
		email: "",
		fromStdin: false,
		resetTwoFactor: false,
		daemon: defaultDaemonUrl(),
	};
	readArgs(argv, {
		flags: {
			"--password-stdin": turnOn(options, "fromStdin"),
			"--reset-two-factor": turnOn(options, "resetTwoFactor"),
		},
		values: {
			"--email": (value = "") => {
				options.email = value;
			},
			"--name": (value) => {
				options.name = value;
			},
			"--daemon": keep(options, "daemon"),
		},
	});
	if (!options.email) throw new BadArguments();
	return options;
}

export const adminCommand = daemonCommand({
	name: "admin",
	help: `  nightshift admin --email <email>          Set how the Host admin signs in from
                                            another computer. --reset-two-factor
                                            also turns two-factor sign-in off.`,
	usage: (program) =>
		`Usage: ${program} --email <email> [--name <name>] [--password-stdin] [--reset-two-factor]\nRun it on the Host. It sets the email and password the Host admin signs in with from another computer.\n--reset-two-factor also turns two-factor sign-in off, for a lost authenticator app.`,
	options: adminOptions,
	run: async (client, { email, name, fromStdin, resetTwoFactor }) => {
		const password = fromStdin
			? (await Bun.stdin.text()).replace(/\r?\n$/, "")
			: await hiddenPrompt("Password: ");
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
	},
});

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
