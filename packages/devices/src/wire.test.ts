import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Auth, DeviceKeyAccess } from "@nightshift/auth";
import { createAuthSandbox } from "@nightshift/auth/testing";
import { event, runCommand, user } from "@nightshift/db/schema";
import {
	createFlowDocuments,
	createSpaceArchive,
	type Device,
	type FlowDocuments,
	type SessionInput,
} from "@nightshift/engine";
import type { DeviceDocument } from "@nightshift/engine/device-config";
import { worktreeLocation } from "@nightshift/engine/projects";
import type { RunStatus } from "@nightshift/engine/run-status";
import {
	createProfileStore,
	createSandbox,
	createSettingsStore,
	type Sandbox,
	waitFor,
} from "@nightshift/engine/testing";
import type { Flow } from "@nightshift/flows";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import type { HostClient, WorkReply, WorkRequest } from "./contract";
import { setDeviceOffer } from "./offers/offers";
import type { PeerEngine } from "./peers";
import { OFFLINE_AFTER_MS } from "./registry";
import { type PairedReplicas, pairedReplicas, withPeers } from "./testing";
import {
	type DevicesRuntime,
	documentsWithHost,
	type KeptDevices,
	startDevices,
} from "./wire";
import { createWorkHub } from "./work";

/**
 * The devices runtime across a `bun --hot` reload: `startDevices` twice in
 * one process, the second with what the first kept. A is the Host, in
 * memory (`pairedReplicas`). B runs the runtime, with its real Links to A.
 */

let a: Sandbox;
let b: Sandbox;
let paired: PairedReplicas;
/** B's Device document: the daemon keeps it across reloads. */
let document: DeviceDocument;
/** B's flow documents: the daemon keeps them across reloads. */
let flows: FlowDocuments;
/** What `bun --hot` keeps between the starts. */
let kept: KeptDevices;
/** B's sessions as a placed Device: each runs until the test ends it. */
let sessions: { input: SessionInput; end(): void }[];
/** The streams of B's Links open on A now, and how many ever opened, by procedure. */
let open: Map<string, number>;
let opened: Map<string, number>;

beforeEach(async () => {
	[a, b] = await Promise.all([createSandbox(), createSandbox()]);
	paired = await pairedReplicas(a, b);
	// B's engine is the runtime's.
	await paired.device.dispose();
	document = await b.openDocument();
	flows = createFlowDocuments({ db: b.db, documents: paired.synced });
	kept = {};
	sessions = [];
	open = new Map();
	opened = new Map();
});
afterEach(async () => {
	await kept.nightshiftDevices?.release();
	await flows.flush();
	await paired.host.dispose();
	await Promise.all([a, b].map((s) => s.cleanup()));
});

/** B's runtime, as the daemon starts it: again on each reload, with what `bun --hot` kept. */
async function startB(
	options: {
		host?: boolean;
		clientFor?: (address: string) => HostClient;
		auth?: Auth;
	} = {},
): Promise<DevicesRuntime> {
	const settings = createSettingsStore({
		document,
		env: options.host ? { NIGHTSHIFT_HOST: "on" } : {},
	});
	const profiles = createProfileStore({ document });
	await Promise.all([settings.load(), profiles.load()]);
	const [owner] = await b.db.select().from(user);
	return startDevices({
		auth: options.auth ?? noPairing,
		db: b.db,
		env: { CORS_ORIGIN: "https://b.invalid" },
		settings,
		profiles,
		document,
		documents: paired.synced,
		spaces: paired.documents,
		flows,
		self: { id: b.deviceId, name: "B" },
		ownerId: owner?.id as string,
		local: placedDevice(),
		dataDir: b.dataDir,
		archive: createSpaceArchive(b.dataDir),
		keyStore: { prefer: "file" },
		scheduler: false,
		disconnect: () => {},
		kept,
		hostClient: counting(options.clientFor ?? toA),
		internals: {
			links: {
				heartbeatMs: 50,
				firstBackoffMs: 10,
				maxBackoffMs: 50,
				streamBackoff: { firstMs: 10, maxMs: 50 },
			},
			presenceMs: 20,
		},
	});
}

/** A's procedures, as B's key calls them. */
const toA = (address: string) => paired.memory.clientFor(paired.key)(address);

/** B as a Device: the test Device, with sessions that run until the test ends them. */
function placedDevice(): Device {
	const { device } = withPeers({
		db: b.db,
		harnesses: {},
		deviceId: b.deviceId,
		dataDir: b.dataDir,
		scheduler: false,
	});
	return {
		...device,
		async *session(input: SessionInput) {
			let end = () => {};
			const ended = new Promise<void>((resolve) => {
				end = resolve;
				input.signal.addEventListener("abort", () => resolve(), {
					once: true,
				});
			});
			sessions.push({ input, end });
			yield { type: "ready", harness: input.harness };
			await ended;
			if (!input.signal.aborted) yield { type: "text", delta: "done" };
		},
	} as unknown as Device;
}

/** A's procedures, counting the streams of B's Links on A. */
function counting(clientFor: (address: string) => HostClient) {
	return (address: string): HostClient => {
		const client = clientFor(address);
		return {
			...client,
			sync: {
				...client.sync,
				stream: counted("sync.stream", client.sync.stream),
			},
			devices: {
				...client.devices,
				work: counted("devices.work", client.devices.work),
			},
		};
	};
}

function counted<
	Call extends (
		input: never,
		options?: never,
	) => Promise<AsyncIterable<unknown>>,
>(name: string, call: Call): Call {
	return (async (input: never, options?: never) => {
		const stream = await call(input, options);
		return (async function* () {
			open.set(name, (open.get(name) ?? 0) + 1);
			opened.set(name, (opened.get(name) ?? 0) + 1);
			try {
				yield* stream;
			} finally {
				open.set(name, (open.get(name) ?? 1) - 1);
			}
		})();
	}) as unknown as Call;
}

/** Waits until B runs one of each stream on A, after `before` work streams opened. */
async function streamsOn(before = 0) {
	await waitFor(
		() =>
			open.get("sync.stream") === 1 &&
			open.get("devices.work") === 1 &&
			(opened.get("devices.work") ?? 0) > before,
		{ label: "B's streams on A", timeoutMs: 15_000 },
	);
}

/** Better Auth for a runtime that serves no pairing: any use of it fails. */
const noPairing = new Proxy({} as Auth, {
	get() {
		throw new Error("Pairing is not served in this test.");
	},
});

/** A command, then a Gate. */
const gateFlow = {
	version: 7,
	inputs: [],
	outputs: [],
	start: "hello",
	nodes: [
		{
			id: "hello",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo hello",
			output: "text",
		},
		{
			id: "ship",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "Ship it?",
			options: [{ name: "approve" }, { name: "reject" }],
			by: "person",
			decider: "typesafe",
		},
	],
	edges: [{ id: "e1", from: "hello", outcome: "pass", to: "ship" }],
} as Flow;

async function statusOn(engine: PeerEngine, runId: string) {
	try {
		return (await engine.space(a.spaceId).getRun(runId)).status;
	} catch {
		return null;
	}
}

function untilStatus(engine: PeerEngine, runId: string, status: RunStatus) {
	return waitFor(async () => (await statusOn(engine, runId)) === status, {
		label: `status ${status}`,
		timeoutMs: 15_000,
	});
}

/** What A recorded of a command: done, and why not. */
async function commandOnA(id: string) {
	const [row] = await a.db
		.select()
		.from(runCommand)
		.where(eq(runCommand.id, id));
	return { done: row?.doneAt != null, error: row?.error ?? null };
}

/** A project of A, with B's Clone of it. */
async function projectOnBoth() {
	const { id } = await paired.host
		.space(a.spaceId)
		.addProject({ repoPath: a.repoPath });
	await paired.projectOnDevice(id, { clone: true });
	return id;
}

describe("the devices runtime across a reload", () => {
	test("from a daemon before the runtime: its Links stop, then its engine lets go; its sweep stops and its work hub stays", async () => {
		const stopped: string[] = [];
		let swept = 0;
		const hub = createWorkHub();
		kept.nightshiftLinks = {
			close: async () => {
				stopped.push("links");
			},
		};
		kept.nightshiftEngine = {
			dispose: async () => {
				stopped.push("engine");
			},
		};
		kept.nightshiftPresence = setInterval(() => {
			swept++;
		}, 5);
		kept.nightshiftWork = hub;

		await startB();
		const at = swept;
		await Bun.sleep(50);
		expect(swept).toBe(at);
		expect(stopped).toEqual(["links", "engine"]);
		expect(kept.nightshiftDevices?.hub).toBe(hub);
		const slots: Record<string, unknown> = { ...kept };
		expect(Object.keys(slots).filter((name) => slots[name])).toEqual([
			"nightshiftDevices",
		]);
	});

	test("the Links and the presence sweep before it stop: one of each runs", async () => {
		const first = await startB();
		await streamsOn();
		let sweptBefore = 0;
		first.engine.devices.sweep = async () => {
			sweptBefore++;
		};
		await waitFor(() => sweptBefore > 0, { label: "a sweep" });

		const second = await startB();
		const stoppedAt = sweptBefore;
		let sweptAfter = 0;
		second.engine.devices.sweep = async () => {
			sweptAfter++;
		};
		await waitFor(() => sweptAfter >= 3, {
			label: "the next runtime's sweeps",
			timeoutMs: 15_000,
		});
		expect(sweptBefore).toBe(stoppedAt);
		await streamsOn(1);
		await Bun.sleep(200);
		expect(Object.fromEntries(open)).toEqual({
			"sync.stream": 1,
			"devices.work": 1,
		});
	});

	test("a Device that takes work again wakes the steps of the new engine, not of the engine before", async () => {
		const first = await startB({ host: true });
		const [owner] = await b.db.select().from(user);
		const personId = owner?.id as string;
		await first.engine.devices.join({
			id: "device-c",
			name: "C",
			platform: "test",
			ownerId: personId,
			homeHost: null,
		});
		const second = await startB({ host: true });
		const woken: string[] = [];
		first.engine.deviceBack = async (deviceId) => {
			woken.push(`before ${deviceId}`);
		};
		second.engine.deviceBack = async (deviceId) => {
			woken.push(`after ${deviceId}`);
		};

		const key: DeviceKeyAccess = {
			keyId: "key-c",
			deviceId: "device-c",
			personId,
			permissions: { relay: ["serve"] },
		};
		const taking = new AbortController();
		const deliveries = second.hostExchange
			.work(key, { running: [] }, taking.signal)
			[Symbol.asyncIterator]();
		const next = deliveries.next();
		await waitFor(() => woken.length > 0, { label: "the wake" });
		expect(woken).toEqual(["after device-c"]);
		taking.abort();
		await next;
	});

	test("a Device online before the reload is online after it, and its presence is logged once", async () => {
		const first = await startB({ host: true });
		const [owner] = await b.db.select().from(user);
		await first.engine.devices.join({
			id: "device-c",
			name: "C",
			platform: "test",
			ownerId: owner?.id as string,
			homeHost: null,
		});
		await first.engine.devices.seen("device-c");

		const second = await startB({ host: true });
		// The next runtime's registry has tidied up what it took for stale.
		await second.engine.devices.sweep(OFFLINE_AFTER_MS);
		expect((await second.engine.devices.get("device-c"))?.online).toBe(true);
		const presence = (await b.db.select().from(event).orderBy(event.seq))
			.map((e) => e.type)
			.filter((type) => type === "DeviceOnline" || type === "DeviceOffline");
		expect(presence).toEqual(["DeviceOnline"]);
	});

	test("from a runtime of an older version, which kept no presence: the Devices online are handed over from then on", async () => {
		await startB({ host: true });
		const older = kept.nightshiftDevices as unknown as Record<string, unknown>;
		delete older.presence;
		delete older.pending;
		const second = await startB({ host: true });
		const [owner] = await b.db.select().from(user);
		await second.engine.devices.join({
			id: "device-c",
			name: "C",
			platform: "test",
			ownerId: owner?.id as string,
			homeHost: null,
		});
		await second.engine.devices.seen("device-c");

		const third = await startB({ host: true });
		expect((await third.engine.devices.get("device-c"))?.online).toBe(true);
	});

	test("a pairing started before the reload keeps the joining Device's name and platform", async () => {
		const people = await createAuthSandbox();
		try {
			const first = await startB({ host: true, auth: people.auth });
			const code = await first.devices.startPairing({
				deviceId: "device-c",
				name: "C",
				platform: "linux",
			});

			const second = await startB({ host: true, auth: people.auth });
			const ada = await people.signUp("Ada");
			const review = await second.devices.review(
				ada.headers,
				code.userCode,
				ada.userId,
			);
			expect(review.device).toEqual({
				id: "device-c",
				name: "C",
				platform: "linux",
			});
		} finally {
			people.cleanup();
		}
	});

	test("a Command B is applying is applied once: the next runtime reports its result", async () => {
		const projectId = await projectOnBoth();
		// B's Link comes online only once B started the run: B walks it itself.
		let linked = false;
		// A never hears from the first runtime: its Link ends with the reload.
		const first = await startB({
			clientFor: (address) => {
				const client = toA(address);
				return {
					...client,
					link: {
						...client.link,
						hello: async (...args: Parameters<typeof client.link.hello>) => {
							if (!linked) {
								throw new TypeError("The network connection was lost.");
							}
							return client.link.hello(...args);
						},
					},
					sync: {
						...client.sync,
						commandDone: async () => {
							throw new TypeError("The network connection was lost.");
						},
					},
				};
			},
		});
		const run = await first.engine
			.space(a.spaceId)
			.startRun({ projectId, flow: gateFlow });
		expect(run.walker).toMatchObject({ id: b.deviceId, thisDevice: true });
		linked = true;
		await untilStatus(paired.host, run.id, "waiting");

		// B's checks of the Command go on only once the reload began.
		const entered = Promise.withResolvers<void>();
		const go = Promise.withResolvers<void>();
		const apply = first.engine.exchange.apply;
		first.engine.exchange.apply = async (command, engine) => {
			entered.resolve();
			await go.promise;
			return apply(command, engine);
		};
		const gate = (await paired.host.space(a.spaceId).listGates())[0];
		await paired.host
			.space(a.spaceId, { personId: paired.personId })
			.act(run.id, {
				kind: "answer",
				stepId: gate?.stepId as string,
				choice: "approve",
			});
		const [command] = await paired.host.exchange.commands.pendingOf([run.id]);
		await entered.promise;

		const reloading = startB();
		await Bun.sleep(100);
		go.resolve();
		await reloading;
		await waitFor(async () => (await commandOnA(command?.id as string)).done, {
			label: "the Command done on A",
			timeoutMs: 15_000,
		});
		expect(await commandOnA(command?.id as string)).toEqual({
			done: true,
			error: null,
		});
		// The Gate was answered once, by the engine before the reload.
		const answers = (
			await b.db.select().from(event).where(eq(event.runId, run.id))
		).filter(
			(e) =>
				e.type === "StepEnded" && JSON.parse(e.payload).outcome === "approve",
		);
		expect(answers).toHaveLength(1);
	});

	test("a call B serves runs on through the reload, once: the next runtime sends its replies", async () => {
		const projectId = await projectOnBoth();
		await startB();
		await streamsOn();
		const run = "abcdef12-0000-0000-0000-000000000000";
		const request: WorkRequest = {
			spaceId: a.spaceId,
			projectId,
			personId: paired.personId,
			runId: run,
			call: {
				kind: "session",
				input: {
					cwd: worktreeLocation(b.repoPath, run.slice(0, 8)).worktreePath,
					prompt: "Work.",
					harness: "claude-code",
					model: "sonnet",
					permissionMode: "acceptEdits",
				},
			},
		};
		// A Walker's call to B, through A.
		const replies: WorkReply[] = [];
		let done = false;
		void (async () => {
			const stream = await paired.memory
				.client(paired.key)
				.devices.call({ deviceId: b.deviceId, request });
			for await (const reply of stream) replies.push(reply);
			done = true;
		})();
		await waitFor(() => replies.length === 1, { label: "the first reply" });

		await startB();
		await streamsOn(1);
		await Bun.sleep(300);
		// A still waits for the call, and B runs its one session.
		expect(replies).toEqual([
			{ kind: "item", item: { type: "ready", harness: "claude-code" } },
		]);
		expect(sessions).toHaveLength(1);
		expect(sessions[0]?.input.signal.aborted).toBe(false);

		sessions[0]?.end();
		await waitFor(() => done, { label: "the call to end", timeoutMs: 15_000 });
		expect(replies).toEqual([
			{ kind: "item", item: { type: "ready", harness: "claude-code" } },
			{ kind: "item", item: { type: "text", delta: "done" } },
		]);
	});

	test("a session under an Offer runs on through the reload and still counts: the next one waits for it", async () => {
		const projectId = await projectOnBoth();
		// B offers "coder" to A's Space, one session at a time, and a
		// colleague of A's owner is a Member there.
		await createProfileStore({ document }).save({
			name: "coder",
			harness: "claude-code",
			model: "sonnet",
			permissionMode: "acceptEdits",
			clis: [],
			connections: [],
		});
		await setDeviceOffer(document, {
			spaceId: a.spaceId,
			profile: "coder",
			permissionCap: "acceptEdits",
			sessionCap: 1,
			offeredAt: 1,
		});
		const space = await paired.documents.open(a.spaceId);
		space.doc.transact(() => {
			space.members.set("colleague", { name: "Colleague", role: "member" });
			space.offers.set(`${b.deviceId}/coder`, {
				deviceId: b.deviceId,
				deviceName: "B",
				profile: "coder",
				permissionCap: "acceptEdits",
				sessionCap: 1,
				offeredAt: 1,
				by: paired.personId,
			});
		});
		/** The colleague's session of one run, sent to B through A. */
		const sessionOf = (runtime: DevicesRuntime, run: string) =>
			(async () => {
				const replies: WorkReply[] = [];
				for await (const reply of runtime.engine.admission.serve(
					{
						spaceId: a.spaceId,
						projectId,
						personId: "colleague",
						runId: run,
						call: {
							kind: "session",
							input: {
								cwd: worktreeLocation(b.repoPath, run.slice(0, 8)).worktreePath,
								prompt: "Work.",
								offered: { profile: "coder" },
							},
						},
					},
					{ hostId: paired.hostId },
					new AbortController().signal,
				)) {
					replies.push(reply);
				}
				return replies;
			})();

		const before = await startB();
		const first = sessionOf(before, "abcdef12-0000-0000-0000-000000000000");
		await waitFor(() => sessions.length === 1, { label: "the first session" });

		const after = await startB();
		const second = sessionOf(after, "beefcafe-0000-0000-0000-000000000000");
		await Bun.sleep(200);
		// The cap is 1: the session from before the reload still holds it.
		expect(sessions).toHaveLength(1);

		sessions[0]?.end();
		await waitFor(() => sessions.length === 2, { label: "the second session" });
		sessions[1]?.end();
		for (const replies of [await first, await second]) {
			expect(replies.at(-1)).toEqual({
				kind: "item",
				item: { type: "text", delta: "done" },
			});
		}
	});
});

describe("the documents a Device syncs with a Host", () => {
	test("each Space document, and the flow and knowledge documents of every Project in it; over the home link, its own document and the copies too", async () => {
		const space = await paired.documents.open(a.spaceId);
		space.doc.transact(() => {
			for (const id of ["project-b", "project-a"]) {
				space.projects.set(id, {
					name: id,
					remote: null,
					createdAt: 1,
					removedAt: null,
					updatedAt: 1,
				});
			}
		});
		const copies = {
			keep: async (devices: readonly { id: string }[]) =>
				devices.map((d) => ({ name: `device:${d.id}`, doc: new Y.Doc() })),
		};
		const from = { documents: paired.synced, document, copies };
		const hello = { devices: [{ id: "laptop", name: "Laptop" }] };
		const synced = await documentsWithHost(from, { role: "guest" }, hello, [
			a.spaceId,
		]);
		expect(synced.map((d) => d.name)).toEqual([
			space.name,
			"flows:project-a",
			"flows-history:project-a",
			"knowledge:project-a",
			"flows:project-b",
			"flows-history:project-b",
			"knowledge:project-b",
		]);
		const opened = await flows.open("project-a");
		expect(synced[1]?.doc).toBe(opened.current.doc);
		expect(synced[2]?.doc).toBe(opened.history.doc);
		expect(synced[3]?.doc).toBe(
			(await paired.synced.open("knowledge:project-a")).doc,
		);

		const home = await documentsWithHost(from, { role: "home" }, hello, []);
		expect(home.map((d) => d.name)).toEqual([document.name, "device:laptop"]);
	});
});
