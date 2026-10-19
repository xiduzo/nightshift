import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	HocuspocusProvider,
	HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import type { AppRouterClient } from "@nightshift/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { Subprocess } from "bun";
import * as Y from "yjs";

/**
 * Two Devices, two daemons: A is a Host, B joins it. Each runs as its own
 * process (the daemon's services are one per process), with its own data
 * directory and port, on this computer. The test calls each daemon as this
 * computer's Person (a loopback request without a session gets the local
 * session), so on A it is A's Person who approves.
 */

const SERVER_DIR = join(import.meta.dir, "../..");
const root = mkdtempSync(join(tmpdir(), "nightshift-two-devices-"));

type Daemon = {
	url: string;
	dataDir: string;
	client: AppRouterClient;
	process: Subprocess;
};

let a: Daemon;
let b: Daemon;

async function freePort(): Promise<number> {
	const probe = Bun.serve({
		port: 0,
		hostname: "localhost",
		fetch: () => new Response(),
	});
	const port = probe.port as number;
	probe.stop(true);
	return port;
}

async function startDaemon(
	name: string,
	env: Record<string, string>,
): Promise<Daemon> {
	const port = await freePort();
	const url = `http://localhost:${port}`;
	const dataDir = join(root, name);
	const child = Bun.spawn(["bun", "src/index.ts"], {
		cwd: SERVER_DIR,
		env: {
			PATH: process.env.PATH ?? "",
			HOME: process.env.HOME ?? root,
			NODE_ENV: "test",
			PORT: String(port),
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
	return { url, dataDir, client, process: child };
}

async function waitFor<T>(
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

beforeAll(async () => {
	[a, b] = await Promise.all([
		startDaemon("a", { NIGHTSHIFT_HOST: "on" }),
		startDaemon("b", {}),
	]);
}, 60_000);

afterAll(async () => {
	for (const daemon of [a, b]) {
		daemon?.process.kill("SIGTERM");
		await daemon?.process.exited;
	}
	rmSync(root, { recursive: true, force: true });
});

describe("two Devices", () => {
	test("a daemon that is not a Host answers on 127.0.0.1 and localhost", async () => {
		const port = new URL(b.url).port;
		for (const host of ["127.0.0.1", "localhost"]) {
			expect(await (await fetch(`http://${host}:${port}/`)).text()).toBe("OK");
		}
	});

	test("B joins A, A's Person approves, B syncs its document with A, revoking ends B's link", async () => {
		// B asks to join, from the command line: it prints the code.
		const cli = Bun.spawn(
			["bun", "src/join-cli.ts", a.url, "--daemon", b.url],
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
		expect(output.join("")).toContain(
			`${new URL("http://localhost:3001/devices").toString()}?pair=${userCode}`,
		);

		// A's Person enters the code: it names the device; then approves.
		const bId = (await b.client.devices.list()).thisComputer?.id as string;
		const review = await a.client.devices.review({ userCode });
		expect(review.device).toMatchObject({
			id: bId,
			platform: process.platform,
		});
		await a.client.devices.approve({ userCode });

		expect(await cli.exited).toBe(0);
		await reader;
		expect(output.join("")).toContain("Paired with");

		// B has its home Host; A shows B online.
		const hostOfB = await waitFor(
			async () => (await b.client.devices.list()).thisComputer?.hosts ?? [],
			(hosts) => hosts[0]?.status === "online",
		);
		expect(hostOfB[0]).toMatchObject({ role: "home", address: a.url });
		const onA = await waitFor(
			async () => (await a.client.devices.list()).devices,
			(devices) => devices[0]?.online === true,
		);
		expect(onA[0]).toMatchObject({ id: bId, homeHost: a.url, revokedAt: null });

		// B's Device document reached A: A's Person opens it there.
		const copy = new Y.Doc();
		const provider = new HocuspocusProvider({
			websocketProvider: new HocuspocusProviderWebsocket({
				url: `ws://127.0.0.1:${new URL(a.url).port}/sync`,
			}),
			name: `device:${bId}`,
			document: copy,
			token: "this-computer",
		});
		provider.attach();
		try {
			await waitFor(
				() => copy.getMap("meta").get("deviceId"),
				(id) => id === bId,
			);
		} finally {
			provider.destroy();
		}

		// A's Person removes B's access: B's link ends.
		await a.client.devices.revoke({ deviceId: bId });
		const after = await waitFor(
			async () => (await b.client.devices.list()).thisComputer?.hosts ?? [],
			(hosts) => hosts[0]?.status === "revoked",
		);
		expect(after).toHaveLength(1);
		expect((await a.client.devices.list()).devices[0]).toMatchObject({
			online: false,
			revokedAt: expect.any(Number),
		});

		// A's log tells it.
		const log = new Database(join(a.dataDir, "nightshift.db"), {
			readonly: true,
		});
		const types = log
			.query<{ type: string }, []>(
				"select type from event where type like 'Device%' order by seq",
			)
			.all()
			.map((row) => row.type);
		log.close();
		expect(types).toEqual([
			"DeviceJoined",
			"DeviceOnline",
			"DeviceRevoked",
			"DeviceOffline",
		]);
	}, 60_000);
});
