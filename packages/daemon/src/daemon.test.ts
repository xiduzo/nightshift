import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonLease } from "@nightshift/db/schema";
import { hostInMemory } from "@nightshift/devices/testing";
import {
	createSandbox,
	type Sandbox,
	syncSpaceDocument,
	waitFor,
} from "@nightshift/engine/testing";
import type { Flow } from "@nightshift/flows";

import { createDaemon, type Daemon, type DaemonOutside } from "./daemon";
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
/** A Replica of another computer: the Host the daemon pairs with. */
let other: Sandbox | null = null;

afterEach(async () => {
	for (const daemon of started.splice(0)) await daemon.stop();
	await other?.cleanup();
	other = null;
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
async function start(
	env: DaemonEnv,
	outside: Pick<DaemonOutside, "hosts"> = {},
): Promise<Daemon> {
	const daemon = await createDaemon(env, {
		port: PORT,
		outside: {
			// "Not modified": the bundled list stays.
			fetch: async () => new Response(null, { status: 304 }),
			sleepLock: null,
			...outside,
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

/** A procedure as this computer's Person calls it: its answer, else it throws. */
async function rpc<T>(daemon: Daemon, path: string, input?: unknown) {
	const response = await call(daemon, `/rpc/${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input === undefined ? {} : { json: input }),
	});
	const body = (await response?.json()) as { json: T };
	if (response?.status !== 200) {
		throw new Error(`${path}: ${response?.status} ${JSON.stringify(body)}`);
	}
	return body.json;
}

/** One Command node: what the Host's run walks. */
const echoFlow = {
	version: 7,
	inputs: [],
	outputs: [],
	start: "echo",
	nodes: [
		{
			id: "echo",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo paired",
			output: "text",
		},
	],
	edges: [],
} as unknown as Flow;

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

	test("pairs with a Host in memory: the Host walks a run it starts, and its stop is clean", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		const env = envIn(dir);
		// A: the Host, in memory, with a project and its Clone there.
		other = await createSandbox();
		const a = other;
		const host = await hostInMemory(a);
		const project = await host.host
			.space(a.spaceId)
			.addProject({ repoPath: a.repoPath });

		// Paired by hand: A takes the daemon's Device, and the daemon keeps the Link.
		const first = await start(env);
		const key = await host.join(first.info.device.id, "B");
		await host.link({
			db: processDatabase(first.info.databaseUrl),
			dataDir: first.info.dataDir,
		});
		// The Link starts with the daemon: its next start reaches A in memory.
		await first.stop();
		started.splice(started.indexOf(first), 1);
		const daemon = await start(env, { hosts: () => host.memory.client(key) });

		type Overview = {
			thisComputer: { hosts: { hostId: string; status: string }[] } | null;
		};
		await waitFor(
			async () =>
				(await rpc<Overview>(daemon, "devices/list")).thisComputer?.hosts.some(
					(h) => h.hostId === host.hostId && h.status === "online",
				),
			{ label: "the Link to A online", timeoutMs: 15_000 },
		);
		// A's Space, as the Link syncs it: its project comes to the daemon.
		const spaces = hot.nightshiftSpaces;
		if (!spaces) throw new Error("The daemon keeps no Space documents.");
		await syncSpaceDocument(host.documents, spaces, a.spaceId);

		await rpc(daemon, "spaces/switch", { spaceId: a.spaceId });
		const run = await rpc<{
			id: string;
			walker: { id: string; thisDevice: boolean };
		}>(daemon, "runs/start", {
			projectId: project.id,
			flow: echoFlow,
			deviceId: a.deviceId,
		});
		expect(run.walker).toMatchObject({ id: a.deviceId, thisDevice: false });
		await waitFor(
			async () =>
				(await rpc<{ status: string }>(daemon, "runs/get", { runId: run.id }))
					.status === "finished",
			{ label: "the run finished, as the daemon has it", timeoutMs: 15_000 },
		);

		await daemon.stop();
		started.splice(started.indexOf(daemon), 1);
		expect(hot.nightshiftLease).toBeUndefined();
		expect(hot.nightshiftDevices).toBeUndefined();
		expect(hot.nightshiftSpaces).toBeUndefined();
		const [lease] = await processDatabase(daemon.info.databaseUrl)
			.select()
			.from(daemonLease);
		expect(lease?.owner).toBeNull();
		await host.host.dispose();
	});
});
