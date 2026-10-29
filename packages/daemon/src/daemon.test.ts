import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonLease } from "@nightshift/db/schema";

import { createDaemon, type Daemon } from "./daemon";
import { type DaemonEnv, hot, processDatabase } from "./runtime";
import type { SocketData } from "./sync";

/**
 * The composition root's own test: the whole daemon, wired in this
 * process over a temporary data folder, with nothing on the network. It
 * answers, and its stop leaves nothing running and the lease free, so the
 * next daemon in this process starts fresh.
 */

const PORT = 47_123;

let dir: string | null = null;
const started: Daemon[] = [];

afterEach(async () => {
	for (const daemon of started.splice(0)) await daemon.stop();
	if (!dir) return;
	for (const url of hot.nightshiftDatabases?.keys() ?? []) {
		if (url.includes(dir)) hot.nightshiftDatabases?.delete(url);
	}
	await rm(dir, { recursive: true, force: true });
	dir = null;
});

function envIn(dataDir: string): DaemonEnv {
	return {
		NODE_ENV: "test",
		NIGHTSHIFT_DATA_DIR: dataDir,
		BETTER_AUTH_URL: `http://127.0.0.1:${PORT}`,
		BETTER_AUTH_SECRET: "a-test-secret-of-at-least-thirty-two-characters",
		CORS_ORIGIN: "http://localhost:3001",
		// No keychain, no scheduler.
		NIGHTSHIFT_KEY_STORE: "file",
		NIGHTSHIFT_SCHEDULER: "off",
	};
}

/** A daemon in this process. The price list is never fetched (the network is never reached), and the OS's sleep lock is never taken. */
async function start(env: DaemonEnv): Promise<Daemon> {
	const daemon = await createDaemon(env, {
		port: PORT,
		outside: {
			// "Not modified": the bundled list stays.
			fetch: async () => new Response(null, { status: 304 }),
			sleepLock: null,
		},
	});
	started.push(daemon);
	return daemon;
}

/** Bun's server as the daemon's handler reads it: the peer is this computer. */
const server = {
	requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 50_000 }),
} as unknown as Bun.Server<SocketData>;

const call = (daemon: Daemon, path: string, init?: RequestInit) =>
	daemon.fetch(new Request(`http://127.0.0.1:${PORT}${path}`, init), server);

describe("the daemon, wired in one process", () => {
	test("answers its health check and a procedure for this computer's Person", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		const daemon = await start(envIn(dir));

		expect(daemon.info.dataDir).toBe(dir);
		expect(daemon.info.reach).toBe("this-computer");
		const health = await call(daemon, "/health");
		expect(health?.status).toBe(200);
		expect(await health?.json()).toMatchObject({ status: "running" });

		// A request from this computer is its owner's: the personal Space.
		const spaces = await call(daemon, "/rpc/spaces/list", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(spaces?.status).toBe(200);
		const body = (await spaces?.json()) as {
			json: { active: string; spaces: { id: string }[] };
		};
		expect(body.json.spaces.map((space) => space.id)).toContain(
			body.json.active,
		);
	});

	test("its stop stops every slot and frees the lease: the next daemon starts fresh", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		const env = envIn(dir);
		const first = await start(env);
		const firstLease = first.info.lease.epoch;
		const spaces = hot.nightshiftSpaces;
		expect(spaces).toBeDefined();
		expect(hot.nightshiftDevices).toBeDefined();

		await first.stop();
		started.splice(started.indexOf(first), 1);

		expect(hot.nightshiftLease).toBeUndefined();
		expect(hot.nightshiftSpaces).toBeUndefined();
		expect(hot.nightshiftDevices).toBeUndefined();
		expect(hot.nightshiftScheduler).toBeUndefined();
		expect(hot.nightshiftSync).toBeUndefined();
		const db = processDatabase(first.info.databaseUrl);
		const [row] = await db.select().from(daemonLease);
		expect(row?.owner).toBeNull();

		const next = await start(env);
		expect(next.info.lease.epoch).toBeGreaterThan(firstLease);
		expect(hot.nightshiftSpaces).not.toBe(spaces);
		expect((await call(next, "/health"))?.status).toBe(200);
	});
});
