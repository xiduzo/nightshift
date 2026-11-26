import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonLease, project as projectTable } from "@nightshift/db/schema";
import { hostInMemory } from "@nightshift/devices/testing";
import type { Knowledge } from "@nightshift/engine";
import {
	NIGHT_SHIFT,
	type PersonActor,
	SpaceNotFound,
} from "@nightshift/engine";
import type { AgentSetup } from "@nightshift/engine/agents";
import {
	createSandbox,
	type Sandbox,
	waitFor,
} from "@nightshift/engine/testing";
import type { Flow } from "@nightshift/flows";
import { FLOW_VERSION } from "@nightshift/flows";
import { eq } from "drizzle-orm";
import { createDaemon, type Daemon, type DaemonOutside } from "./daemon";
import * as http from "./http";
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
	outside: Pick<DaemonOutside, "hosts" | "documents"> = {},
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
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "echo",
	nodes: [
		{
			id: "echo",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo paired",
			stdout: "text",
		},
	],
	edges: [],
} as unknown as Flow;

describe("the daemon, wired in one process", () => {
	test("refuses to start in production without an auth secret", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		const { BETTER_AUTH_SECRET: _, ...env } = envIn(dir);
		await expect(start({ ...env, NODE_ENV: "production" })).rejects.toThrow(
			"BETTER_AUTH_SECRET is not set",
		);
	});

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

	test("answers a request that needs no session: the API reference", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		const daemon = await start(envIn(dir));
		const reference = await call(daemon, "/api-reference");
		expect(reference?.status).toBe(200);
	});

	test("a Command's Person changes knowledge by their role in the Space document, and nobody else", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		const daemon = await start(envIn(dir));
		const { you, space } = await rpc<{ you: string; space: { id: string } }>(
			daemon,
			"members/list",
		);
		const knowledge = hot.nightshiftKnowledge as Knowledge;
		const turnOff = (personId: string) =>
			knowledge.setMeaning(
				{ personId, door: "command" },
				{ spaceId: space.id, projectId: "p1", on: false },
			);
		await processDatabase(daemon.info.databaseUrl)
			.insert(projectTable)
			.values({ id: "p1", spaceId: space.id, name: "P1" });
		await expect(turnOff("stranger")).rejects.toThrow(SpaceNotFound);
		await turnOff(you);
	});

	test("its owner reaches its settings, its secrets, its Space's secrets and its guided setup, and another Person is refused inside", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		const daemon = await start(envIn(dir));
		for (const path of [
			"settings/get",
			"connections/list",
			"agentSetup/status",
		]) {
			await rpc(daemon, path);
		}
		await rpc(daemon, "projects/setSpaceSecret", { name: "TOKEN", value: "v" });
		expect(await rpc(daemon, "projects/spaceSecrets")).toMatchObject({
			secrets: [{ name: "TOKEN" }],
		});
		const setup = hot.nightshiftAgentSetup as AgentSetup;
		expect(() =>
			setup.status({
				actor: { personId: "stranger", door: "session" },
				here: true,
			}),
		).toThrow("Only the owner of this computer can see or change this.");
	});

	test("the owner of this computer, and no other Person, gets past each service behind the procedures", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		// What the composition gives the procedures, before any door.
		const given = spyOn(http, "createHttp");
		const daemon = await start(envIn(dir));
		const services = given.mock.calls[0]?.[0];
		given.mockRestore();
		if (!services) throw new Error("The daemon made no HTTP.");
		const { you, space } = await rpc<{ you: string; space: { id: string } }>(
			daemon,
			"members/list",
		);
		await processDatabase(daemon.info.databaseUrl)
			.insert(projectTable)
			.values({ id: "p1", spaceId: space.id, name: "P1", folder: false });
		const { deviceConfig, connections, projectSetup, configUse } = services;
		const inSpace = { spaceId: space.id, projectId: "p1" };
		const secret = { name: "TOKEN", value: "v" };

		/** What only the owner of this computer may ask. */
		const ofComputer: Record<string, (actor: PersonActor) => unknown> = {
			viewSettings: (a) => deviceConfig.viewSettings(a),
			listFoundPrograms: (a) => deviceConfig.listFoundPrograms(a),
			saveCliTool: (a) =>
				deviceConfig.saveCliTool(a, {
					name: "tool",
					description: "A tool",
					program: "tool",
				} as Parameters<typeof deviceConfig.saveCliTool>[1]),
			removeProfile: (a) => deviceConfig.removeProfile(a, { id: "none" }),
			saveSecret: (a) => deviceConfig.saveSecret(a, secret),
			secrets: (a) => connections.secrets(a),
			agentStatus: (a) => services.agentSetup.status({ actor: a, here: false }),
			deciderStatus: (a) =>
				services.deciderSetup.status({ actor: a, here: false }),
			installGit: (a) => projectSetup.installGit(a),
			gitHubAccess: (a) => projectSetup.gitHub.access(a),
			gitHubRepos: (a) => projectSetup.gitHub.repos(a),
		};
		/** What every Member of the Space may ask. */
		const ofSpace: Record<string, (actor: PersonActor) => unknown> = {
			saveSpaceSecret: (a) =>
				deviceConfig.saveSpaceSecret(a, { spaceId: space.id, ...secret }),
			saveProjectSecret: (a) =>
				deviceConfig.saveProjectSecret(a, { project: inSpace, ...secret }),
			spaceSecrets: (a) => connections.spaceSecrets(a, space.id),
			projectSecrets: (a) => connections.projectSecrets(a, inSpace),
			profilesInUse: (a) => configUse.profiles({ spaceId: space.id, actor: a }),
			cliToolsInUse: (a) => configUse.cliTools({ spaceId: space.id, actor: a }),
			spaceSecretsInUse: (a) =>
				configUse.sharedSecrets({ spaceId: space.id, actor: a }, "space"),
		};
		const answers = async (asks: typeof ofSpace, personId: string) => {
			const answered: Record<string, string> = {};
			for (const [name, ask] of Object.entries(asks)) {
				try {
					await ask({ personId, door: "session" });
					answered[name] = "answered";
				} catch (error) {
					answered[name] = (error as Error).name;
				}
			}
			return answered;
		};
		const each = (asks: object, answer: string) =>
			Object.fromEntries(Object.keys(asks).map((name) => [name, answer]));

		// No program starts here: an installer opens a dialog of the OS.
		const spawn = spyOn(Bun, "spawn").mockImplementation((() => {
			throw new Error("A program started.");
		}) as never);
		try {
			expect(await answers(ofComputer, "stranger")).toEqual(
				each(ofComputer, "NotComputerOwner"),
			);
			expect(await answers(ofSpace, "stranger")).toEqual(
				each(ofSpace, "SpaceNotFound"),
			);
			expect(await answers(ofSpace, you)).toEqual(each(ofSpace, "answered"));
			const byOwner = Object.values(await answers(ofComputer, you));
			expect(byOwner).not.toContain("NotComputerOwner");
		} finally {
			spawn.mockRestore();
		}
	});

	test("its stop stops every slot and frees the lease: the next daemon starts fresh", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		const env = envIn(dir);
		const first = await start(env);
		const firstLease = first.info.lease.epoch;
		const documents = hot.nightshiftDocuments;
		expect(documents).toBeDefined();
		expect(hot.nightshiftDevices).toBeDefined();

		await first.stop();
		started.splice(started.indexOf(first), 1);

		expect(hot.nightshiftLease).toBeUndefined();
		expect(hot.nightshiftDocuments).toBeUndefined();
		expect(hot.nightshiftDevices).toBeUndefined();
		expect(hot.nightshiftScheduler).toBeUndefined();
		expect(hot.nightshiftSync).toBeUndefined();
		expect(hot.nightshiftKnowledge).toBeUndefined();
		const db = processDatabase(first.info.databaseUrl);
		const [row] = await db.select().from(daemonLease);
		expect(row?.owner).toBeNull();

		const next = await start(env);
		expect(next.info.lease.epoch).toBeGreaterThan(firstLease);
		expect(hot.nightshiftDocuments).not.toBe(documents);
		expect((await call(next, "/health"))?.status).toBe(200);
	});

	test("a first start that fails gives the lease up and stops every slot: the next start begins fresh", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		const env = envIn(dir);
		await expect(
			start({ ...env, NIGHTSHIFT_LISTEN: "127.0.0.1:3000" }),
		).rejects.toThrow("127.0.0.1:3000 is not an address to listen on.");

		expect(hot.nightshiftLease).toBeUndefined();
		expect(hot.nightshiftDocuments).toBeUndefined();
		const url = [...(hot.nightshiftDatabases?.keys() ?? [])].find((each) =>
			each.includes(dir as string),
		);
		const [row] = await processDatabase(url as string)
			.select()
			.from(daemonLease);
		expect(row?.owner).toBeNull();

		const next = await start(env);
		expect(next.info.lease.epoch).toBe((row?.epoch ?? 0) + 1);
		expect((await call(next, "/health"))?.status).toBe(200);
	});

	test("a stop that outlasts its bound ends before the next start: the next start holds the lease", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		const env = envIn(dir);
		// A first start that fails late, on an error of its own, while one of
		// its slots (the telemetry) stops only when the test says so.
		let finish = () => {};
		const slow = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const failing = spyOn(http, "createHttp").mockImplementationOnce(() => {
			const made = hot.nightshiftTelemetry;
			if (!made) throw new Error("The daemon made no telemetry.");
			const stop = made.stop.bind(made);
			made.stop = async () => {
				await slow;
				await stop();
			};
			throw new Error("A start that fails late.");
		});
		await expect(start(env)).rejects.toThrow("A start that fails late.");
		failing.mockRestore();

		const said = spyOn(console, "log");
		const next = start(env);
		const first = await Promise.race([
			next.then(() => "started" as const),
			Bun.sleep(6_500).then(() => "waits" as const),
		]);
		const waits = said.mock.calls.filter(
			([line]) =>
				line ===
				"Night Shift waits until the Night Shift before it has stopped.",
		);
		said.mockRestore();
		finish();
		const daemon = await next;
		await Bun.sleep(100);

		const [row] = await processDatabase(daemon.info.databaseUrl)
			.select()
			.from(daemonLease);
		expect(row?.owner).toBe(daemon.info.leaseOwner);
		expect((await call(daemon, "/health"))?.status).toBe(200);
		expect(first).toBe("waits");
		// One line while it waits.
		expect(waits).toHaveLength(1);
	}, 30_000);

	test("a second stop waits for a slow first one: the lease stays until the first ended", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		const daemon = await start(envIn(dir));
		started.splice(started.indexOf(daemon), 1);
		let finish = () => {};
		const slow = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const made = hot.nightshiftTelemetry;
		if (!made) throw new Error("The daemon made no telemetry.");
		const stop = made.stop.bind(made);
		made.stop = async () => {
			await slow;
			await stop();
		};
		const lease = async () => {
			const [row] = await processDatabase(daemon.info.databaseUrl)
				.select()
				.from(daemonLease);
			return row?.owner ?? null;
		};

		// Each stop gives up at its bound: the first still waits for the telemetry.
		await daemon.stop();
		await daemon.stop();
		expect(await lease()).toBe(daemon.info.leaseOwner);

		finish();
		await hot.nightshiftStopping;
		expect(await lease()).toBeNull();
	}, 30_000);

	test("a stop while the price list is fetched aborts the fetch and leaves no price updates behind", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		let asked: AbortSignal | undefined;
		const daemon = await createDaemon(envIn(dir), {
			port: PORT,
			outside: {
				// A fetch that answers only when it is aborted.
				fetch: (_url, init) =>
					new Promise<Response>((_resolve, reject) => {
						asked = init?.signal ?? undefined;
						asked?.addEventListener("abort", () =>
							reject(new DOMException("The fetch was aborted.", "AbortError")),
						);
					}),
				sleepLock: null,
			},
		});
		for (let i = 0; i < 100 && !asked; i++) await Bun.sleep(10);
		expect(asked?.aborted).toBe(false);
		const warned = spyOn(console, "warn");

		await daemon.stop();
		await hot.nightshiftStopping;

		expect(asked?.aborted).toBe(true);
		expect(hot.nightshiftPrices).toBeUndefined();
		expect(
			warned.mock.calls.some(([line]) =>
				String(line).startsWith("The price list was not updated"),
			),
		).toBe(false);
		warned.mockRestore();
	});

	test("a reload aborts the price list fetch of the daemon before it", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		let asked: AbortSignal | undefined;
		const before = await createDaemon(envIn(dir), {
			port: PORT,
			outside: {
				// A fetch that answers only when it is aborted.
				fetch: (_url, init) =>
					new Promise<Response>((_resolve, reject) => {
						asked = init?.signal ?? undefined;
						asked?.addEventListener("abort", () =>
							reject(new DOMException("The fetch was aborted.", "AbortError")),
						);
					}),
				sleepLock: null,
			},
		});
		started.push(before);
		for (let i = 0; i < 100 && !asked; i++) await Bun.sleep(10);
		expect(asked?.aborted).toBe(false);

		await start(envIn(dir));
		for (let i = 0; i < 100 && !asked?.aborted; i++) await Bun.sleep(10);
		expect(asked?.aborted).toBe(true);
	});

	test("a reload that fails keeps the lease: the daemon before it still holds the database", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		const env = envIn(dir);
		const first = await start(env);
		await expect(
			start({ ...env, NIGHTSHIFT_LISTEN: "127.0.0.1:3000" }),
		).rejects.toThrow("is not an address to listen on.");

		expect(hot.nightshiftLease).toBeDefined();
		const [row] = await processDatabase(first.info.databaseUrl)
			.select()
			.from(daemonLease);
		expect(row?.owner).toBe(first.info.leaseOwner);
	});

	test("a reload makes its own knowledge, and the one before closes", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		const env = envIn(dir);
		const first = await start(env);
		const before = hot.nightshiftKnowledge as Knowledge;
		const closed = spyOn(before, "close");
		const locks = hot.nightshiftKnowledgeFolderLocks;
		expect(locks).toBeDefined();

		// As `bun --hot` does: a new daemon in this process, and nothing stopped.
		const reloaded = await start(env);
		started.splice(started.indexOf(first), 1);

		expect(closed).toHaveBeenCalledTimes(1);
		expect(hot.nightshiftKnowledge).toBeDefined();
		expect(hot.nightshiftKnowledge).not.toBe(before);
		// A step of the one before still holds its folder.
		expect(hot.nightshiftKnowledgeFolderLocks).toBe(locks);
		expect(await rpc<unknown[]>(reloaded, "knowledge/learnings")).toEqual([]);
	});

	test("tells a screen that listens when the learnings that wait change", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		const daemon = await start(envIn(dir));
		const { active } = await rpc<{ active: string }>(daemon, "spaces/list");
		await processDatabase(daemon.info.databaseUrl)
			.insert(projectTable)
			.values({ id: "p1", spaceId: active, name: "p1" });
		const stop = new AbortController();
		const watch = await call(daemon, "/rpc/notifications/watch", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
			signal: stop.signal,
		});
		const stream = watch?.body?.getReader();
		if (!stream) throw new Error("The stream did not open.");

		// A step on this computer proposed something: the page's read publishes it.
		const proposed = join(dir, "knowledge", "p1", "learnings", "proposed");
		await mkdir(proposed, { recursive: true });
		await writeFile(join(proposed, "run-1.s1.md"), "- Use bun.\n");
		await rpc(daemon, "knowledge/get", { projectId: "p1" });

		let heard = "";
		while (!heard.includes("learnings-changed")) {
			const { done, value } = await stream.read();
			if (done) break;
			heard += new TextDecoder().decode(value);
		}
		stop.abort();
		await stream.cancel().catch(() => {});
		expect(heard).toContain("learnings-changed");
		expect(heard).toContain('"projectId":"p1"');
	});

	test("tells a screen that listens when a schedule is paused tonight", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		const daemon = await start(envIn(dir));
		const { active } = await rpc<{ active: string }>(daemon, "spaces/list");
		// A project without a folder: its schedules need no Clone here.
		await processDatabase(daemon.info.databaseUrl)
			.insert(projectTable)
			.values({ id: "p1", spaceId: active, name: "p1", folder: false });
		await rpc(daemon, "schedules/save", {
			projectId: "p1",
			schedules: [
				{
					id: "nightly",
					flow: "night",
					inputs: {},
					cron: "0 22 * * *",
					enabled: true,
				},
			],
		});
		const stop = new AbortController();
		const watch = await call(daemon, "/rpc/notifications/watch", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
			signal: stop.signal,
		});
		const stream = watch?.body?.getReader();
		if (!stream) throw new Error("The stream did not open.");

		const pause = await rpc<{ pausedUntil: number | null }>(
			daemon,
			"schedules/pauseTonight",
			{ projectId: "p1", scheduleId: "nightly" },
		);
		expect(pause.pausedUntil).not.toBeNull();

		let heard = "";
		while (!heard.includes("schedules-changed")) {
			const { done, value } = await stream.read();
			if (done) break;
			heard += new TextDecoder().decode(value);
		}
		stop.abort();
		await stream.cancel().catch(() => {});
		expect(heard).toContain("schedules-changed");
		expect(heard).toContain('"projectId":"p1"');
	});

	test("pairs with a Host in memory: the Host walks a run it starts, and its stop is clean", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-daemon-"));
		const env = envIn(dir);
		// A: the Host, in memory, with a project and its Clone there.
		other = await createSandbox();
		const a = other;
		const host = await hostInMemory(a);
		const project = await host.host
			.space(a.spaceId, NIGHT_SHIFT)
			.addProject({ repoPath: a.repoPath });

		// Paired by hand: A takes the daemon's Device, and the daemon keeps the Link.
		const first = await start(env);
		const key = await host.join(first.info.device.id, "B");
		await host.link(
			{
				db: processDatabase(first.info.databaseUrl),
				dataDir: first.info.dataDir,
			},
			key,
		);
		// The Link starts with the daemon: its next start reaches A in memory.
		await first.stop();
		started.splice(started.indexOf(first), 1);
		const daemon = await start(env, {
			hosts: () => host.memory.client(key),
			documents: host.memory.documentChannel,
		});

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
		const db = processDatabase(daemon.info.databaseUrl);
		await waitFor(
			async () =>
				(
					await db
						.select({ id: projectTable.id })
						.from(projectTable)
						.where(eq(projectTable.id, project.id))
				).length > 0,
			{ label: "A's project on the daemon", timeoutMs: 15_000 },
		);

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
		expect(hot.nightshiftDocuments).toBeUndefined();
		const [lease] = await processDatabase(daemon.info.databaseUrl)
			.select()
			.from(daemonLease);
		expect(lease?.owner).toBeNull();
		await host.host.dispose();
	});
});
