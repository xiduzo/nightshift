import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	HocuspocusProvider,
	HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import * as Y from "yjs";

import {
	type Daemon,
	SERVER_DIR,
	startDaemon,
	stopDaemon,
	waitFor,
} from "../test-daemons";

/**
 * Two Devices, two daemons: A is a Host, B joins it. Each runs as its own
 * process (the daemon's services are one per process), with its own data
 * directory and port, on this computer. The test calls each daemon as this
 * computer's Person (a loopback request without a session gets the local
 * session), so on A it is A's Person who approves.
 */

const root = mkdtempSync(join(tmpdir(), "nightshift-two-devices-"));

let a: Daemon;
let b: Daemon;

beforeAll(async () => {
	[a, b] = await Promise.all([
		startDaemon(root, "a", { NIGHTSHIFT_HOST: "on" }),
		startDaemon(root, "b", {}),
	]);
}, 60_000);

afterAll(async () => {
	await Promise.all([stopDaemon(a), stopDaemon(b)]);
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
