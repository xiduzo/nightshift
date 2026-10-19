import { join } from "node:path";
import type { AppRouterClient } from "@nightshift/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { Subprocess } from "bun";

/**
 * Daemons as processes, for tests of several Devices: each runs on its
 * own port with its own data directory (the daemon's services are one per
 * process). A test calls each daemon as that computer's Person: a
 * loopback request without a session gets the local session.
 */

export const SERVER_DIR = join(import.meta.dir, "../..");

export type Daemon = {
	name: string;
	url: string;
	port: number;
	dataDir: string;
	env: Record<string, string>;
	client: AppRouterClient;
	process: Subprocess<"ignore", "ignore", "pipe">;
};

export async function freePort(): Promise<number> {
	const probe = Bun.serve({
		port: 0,
		hostname: "localhost",
		fetch: () => new Response(),
	});
	const port = probe.port as number;
	probe.stop(true);
	return port;
}

/** Starts a daemon in `<root>/<name>`, on `port` (a free one by default), and waits until it answers. */
export async function startDaemon(
	root: string,
	name: string,
	env: Record<string, string>,
	port?: number,
): Promise<Daemon> {
	const at = port ?? (await freePort());
	const url = `http://localhost:${at}`;
	const dataDir = join(root, name);
	const child = Bun.spawn(["bun", "src/index.ts"], {
		cwd: SERVER_DIR,
		env: {
			PATH: process.env.PATH ?? "",
			HOME: process.env.HOME ?? root,
			NODE_ENV: "test",
			PORT: String(at),
			BETTER_AUTH_SECRET: `a-test-secret-of-at-least-32-characters-${name}`,
			BETTER_AUTH_URL: url,
			CORS_ORIGIN: "http://localhost:3001",
			NIGHTSHIFT_DATA_DIR: dataDir,
			NIGHTSHIFT_SCHEDULER: "off",
			NIGHTSHIFT_KEY_STORE: "file",
			...env,
		},
		stdout: "ignore",
		stderr: "pipe",
	});
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(
				`${name} stopped: ${await new Response(child.stderr).text()}`,
			);
		}
		try {
			if ((await fetch(url)).ok) break;
		} catch {}
		await Bun.sleep(100);
	}
	const client: AppRouterClient = createORPCClient(
		new RPCLink({ url: `${url}/rpc` }),
	);
	return { name, url, port: at, dataDir, env, client, process: child };
}

/** Stops a daemon the way a person does (SIGTERM), and waits for it. */
export async function stopDaemon(daemon: Daemon | undefined): Promise<void> {
	if (!daemon) return;
	daemon.process.kill("SIGTERM");
	await daemon.process.exited;
}

export async function waitFor<T>(
	read: () => Promise<T> | T,
	until: (value: T) => boolean,
	timeoutMs = 20_000,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let value = await read();
	while (!until(value)) {
		if (Date.now() > deadline) {
			throw new Error(`Timed out; last value: ${JSON.stringify(value)}`);
		}
		await Bun.sleep(100);
		value = await read();
	}
	return value;
}

/**
 * Pairs `device` with `host` through the command line, `host`'s Person
 * approving the code. Returns the joining Device's id.
 */
export async function pair(host: Daemon, device: Daemon): Promise<string> {
	const cli = Bun.spawn(
		["bun", "src/join-cli.ts", host.url, "--daemon", device.url],
		{ cwd: SERVER_DIR, stdout: "pipe", stderr: "pipe" },
	);
	const output: string[] = [];
	const reader = (async () => {
		const decoder = new TextDecoder();
		for await (const chunk of cli.stdout) output.push(decoder.decode(chunk));
	})();
	const code = await waitFor(
		() => /\b([A-Z0-9]{4})-([A-Z0-9]{4})\b/.exec(output.join("")),
		(match) => match !== null,
	);
	const userCode = `${code?.[1]}${code?.[2]}`;
	await host.client.devices.review({ userCode });
	await host.client.devices.approve({ userCode });
	if ((await cli.exited) !== 0) {
		throw new Error(`join failed: ${await new Response(cli.stderr).text()}`);
	}
	await reader;
	return (await device.client.devices.list()).thisComputer?.id as string;
}
