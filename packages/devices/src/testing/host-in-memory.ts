import type { Auth, DeviceKeyAccess } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { hostLink, user } from "@nightshift/db/schema";
import {
	createFlowDocuments,
	createKnowledgeStore,
	type FlowDocuments,
} from "@nightshift/engine";
import {
	createSpaceDocuments,
	type SpaceDocuments,
} from "@nightshift/engine/projects";
import {
	createRunLog,
	createSettingsStore,
	type Sandbox,
	type TestEngineOptions,
} from "@nightshift/engine/testing";
import * as Y from "yjs";
import type { HostClient, HostHello, WorkRelay } from "../contract";
import { createHostExchange, type HostExchange } from "../exchange";
import { createHost } from "../host";
import { type DeviceLinks, deviceKeyStore, type Link } from "../links";
import { createPeerEngine, deviceDirectory, type PeerEngine } from "../peers";
import { createRelay } from "../relay";
import { createWorkHub } from "../work";
import { inMemoryHost, type MemoryHost } from "./in-memory-host";
import { withPeers } from "./peers";

/** Replica A as a Host in this process: its engine, its exchange, and its procedures in memory. */
export type HostReplica = {
	/** A's engine: the Host, and the Walker of its own runs. */
	host: PeerEngine;
	/** A's exchange, as its API serves it. */
	hostExchange: HostExchange;
	/** A's procedures in memory: `memory.client(key)` is what a Device calls. */
	memory: MemoryHost;
	/** A's Space documents: its engine's. */
	documents: SpaceDocuments;
	/** A's flow documents: its engine's. */
	flows: FlowDocuments;
	/** A's id, as a Device names its Host. */
	hostId: string;
	/** A's owner: the Person of every Device that joins. */
	personId: string;
	/** A's answer to a Device with this key (`link.hello`). */
	hello(key: DeviceKeyAccess): Promise<HostHello>;
	/** A's registry takes a Device of A's owner, as pairing does: its key on A. */
	join(deviceId: string, name: string): Promise<DeviceKeyAccess>;
	/**
	 * The Link of a Replica to A, as pairing leaves it: a `host_link` (A
	 * is its home Host) and its key in the Replica's file key store. Its
	 * address reaches nothing: the Host at an address is
	 * `memory.client(key)`, as the Replica's runtime is told.
	 */
	link(replica: { db: Database; dataDir: string }): Promise<void>;
};

/** How A behaves as a Host. */
export type HostReplicaOptions = Partial<
	Pick<TestEngineOptions, "harnesses">
> & {
	/** How A's calls reach its paired Devices. Default: they reach none. */
	hostWork?: WorkRelay;
};

/**
 * Replica A as a Host, with "Be a Host" on, in this process: its engine
 * with its peers, its exchange of run history, and its procedures behind
 * `HostClient` (`inMemoryHost`). It serves no pairing: a Device joins by
 * hand (`join`, `link`). A's own relay has no links.
 */
export async function hostInMemory(
	a: Sandbox,
	options: HostReplicaOptions = {},
): Promise<HostReplica> {
	const [owner] = await a.db.select().from(user);
	if (!owner) throw new Error("A has no owner.");
	const personId = owner.id;
	const hostId = a.deviceId;

	// A's Space documents: the engine's, and where the Host records a Clone.
	const documents = createSpaceDocuments({
		db: a.db,
		directory: deviceDirectory(a.db),
	});
	const flows = createFlowDocuments({ db: a.db });
	const host: PeerEngine = createPeerEngine(
		withPeers({
			db: a.db,
			harnesses: options.harnesses ?? {},
			deviceId: a.deviceId,
			dataDir: a.dataDir,
			scheduler: false,
			spaceDocuments: documents,
			flowDocuments: flows,
			...(options.hostWork ? { work: options.hostWork } : {}),
			relay: createRelay({
				engine: () => host,
				registry: () => host.devices,
				links: () => linksTo(new Map()),
				flows,
			}),
		}),
		{ runLog: createRunLog(a.db, { walkerId: a.deviceId }) },
	);
	// A as a Host, with "Be a Host" on: its own answer to a link. It serves
	// no pairing here, so it needs no Better Auth.
	const settings = createSettingsStore({
		document: await a.openDocument(),
		env: { NIGHTSHIFT_HOST: "on" },
	});
	await settings.load();
	const asHost = createHost({
		auth: noPairing,
		db: a.db,
		registry: host.devices,
		settings,
		self: { id: hostId, name: "A" },
		devicesPage: "https://a.invalid/devices",
		fingerprint: null,
		disconnect: () => {},
	});
	const hostExchange = createHostExchange({
		db: a.db,
		engine: host,
		registry: host.devices,
		selfId: a.deviceId,
		ownerId: personId,
		isHost: asHost.isHost,
		work: createWorkHub(),
		knowledge: createKnowledgeStore(a.dataDir),
	});
	const memory = inMemoryHost({
		exchange: hostExchange,
		hello: asHost.hello,
		revoke: asHost.revoke,
	});

	return {
		host,
		hostExchange,
		memory,
		documents,
		flows,
		hostId,
		personId,
		hello: asHost.hello,
		async join(deviceId, name) {
			await host.devices.join({
				id: deviceId,
				name,
				platform: "test",
				ownerId: personId,
				// A is its home Host, as its link says (`link`).
				homeHost: "https://a.invalid",
			});
			return {
				keyId: `key-${deviceId}`,
				deviceId,
				personId,
				permissions: {
					sync: ["pull", "push"],
					relay: ["serve"],
					archive: ["put", "get"],
				},
			};
		},
		async link(replica) {
			await replica.db.insert(hostLink).values({
				hostId,
				name: "A",
				addresses: JSON.stringify(["http://127.0.0.1:9"]),
				role: "home",
				personId,
				keyStore: "file",
			});
			const keys = await deviceKeyStore({
				dataDir: replica.dataDir,
				prefer: "file",
			});
			await keys.set(hostId, "memory");
		},
	};
}

/** Better Auth for a Host that serves no pairing: any use of it fails. */
const noPairing = new Proxy({} as Auth, {
	get() {
		throw new Error("Pairing is not served in memory.");
	},
});

/**
 * A Replica's documents and its Host's, by name, as a Link in memory
 * compares them. Null: that side does not have it.
 */
export type DocumentPairs = {
	here(name: string): Promise<Y.Doc | null>;
	host(name: string): Promise<Y.Doc | null>;
};

/**
 * Whether the Host's copy has every change of this Replica's: what the
 * Hocuspocus provider of a real Link waits for. Nothing syncs in memory:
 * a test that wants them in step copies the updates itself.
 */
async function hostHasAll(documents: DocumentPairs, name: string) {
	const here = await documents.here(name);
	if (!here) return true;
	const host = await documents.host(name);
	const probe = new Y.Doc();
	if (host) Y.applyUpdate(probe, Y.encodeStateAsUpdate(host));
	const before = Y.snapshot(probe);
	Y.applyUpdate(probe, Y.encodeStateAsUpdate(here));
	const after = Y.snapshot(probe);
	probe.destroy();
	return Y.equalSnapshots(before, after);
}

/**
 * Links that are always online, one per Host: what a relay reads. They
 * run no streams: a test of the exchange starts its own `httpsLink`.
 * `inStep` compares the documents of `documents` (a link without them
 * cannot answer it): in step once the Host's copy has every change this
 * Replica made. It does not model the other half, this Replica taking
 * the Host's state.
 */
export function linksTo(
	clients: Map<string, HostClient>,
	documents?: DocumentPairs,
): DeviceLinks {
	async function inStep(
		names: readonly string[],
		options: { timeoutMs?: number; signal?: AbortSignal } = {},
	): Promise<boolean> {
		if (!documents) {
			throw new Error("This link in memory compares no documents.");
		}
		const pairs = documents;
		const all = async () => {
			for (const name of names)
				if (!(await hostHasAll(pairs, name))) return false;
			return true;
		};
		const end = Date.now() + (options.timeoutMs ?? 10_000);
		while (true) {
			if (await all()) return true;
			if (Date.now() >= end || options.signal?.aborted) return false;
			await Bun.sleep(20);
		}
	}

	const linkOf = (hostId: string, client: HostClient): Link => ({
		hostId,
		state: () => ({ status: "online", address: "memory", since: 0 }),
		client: () => client,
		stream: () => {
			throw new Error("This link runs no streams in memory.");
		},
		call: (use) => use(client),
		ready: async () => client,
		check: () => {},
		inStep,
		close: async () => {},
	});
	return {
		start: async () => {},
		add: async () => {},
		hosts: async () => [],
		get: (hostId) => {
			const client = clients.get(hostId);
			return client ? linkOf(hostId, client) : undefined;
		},
		close: async () => {},
	};
}
