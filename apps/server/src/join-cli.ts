import type { AppRouterClient } from "@nightshift/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

/**
 * `bun run join <host-url> [--guest]`: pairs this computer with a Host.
 * Night Shift must run on this computer: it does the pairing and keeps the
 * link (`devices.join`). This prints the code to approve on the Host and
 * waits until the Host answers.
 *
 * `--guest`: the Host gets this computer's shared Spaces only, never its
 * own settings. `--daemon <url>`: where Night Shift runs on this computer
 * (default http://localhost:$PORT, else 3000).
 */

const USAGE =
	"Usage: bun run join <host-address> [--guest] [--daemon <address>]\nExample: bun run join https://studio.example.com";

function parse(argv: string[]) {
	const args = [...argv];
	let url: string | null = null;
	let role: "home" | "guest" = "home";
	let daemon =
		process.env.NIGHTSHIFT_DAEMON_URL ??
		`http://localhost:${process.env.PORT || 3000}`;
	while (args.length > 0) {
		const arg = args.shift() as string;
		if (arg === "--guest") role = "guest";
		else if (arg === "--daemon") daemon = args.shift() ?? daemon;
		else if (arg === "--help" || arg === "-h") return null;
		else url = arg;
	}
	return url ? { url, role, daemon } : null;
}

async function main() {
	const options = parse(process.argv.slice(2));
	if (!options) {
		console.log(USAGE);
		process.exit(options === null ? 2 : 0);
	}
	const client: AppRouterClient = createORPCClient(
		new RPCLink({ url: `${options.daemon.replace(/\/$/, "")}/rpc` }),
	);
	try {
		await client.healthCheck();
	} catch {
		console.error(
			`Night Shift does not run on this computer (${options.daemon}). Start it first.`,
		);
		process.exit(1);
	}

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
						"",
						`Or open ${step.verificationUriComplete}`,
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

await main();
