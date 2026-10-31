import {
	type Auth,
	createLocalSession,
	type DeviceKeyAccess,
	type SyncDeviceKey,
} from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { hostLink, user } from "@nightshift/db/schema";
import {
	createFlowDocuments,
	createSyncedDocuments,
	type FlowDocuments,
	type SyncedDocuments,
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
import type { HostClient, HostHello, WorkRelay } from "../contract";
import { createHostExchange, type HostExchange } from "../exchange";
import { createHost, servedDocuments } from "../host";
import {
	type DeviceLinks,
	deviceKeyStore,
	type Link,
	type OpenDocumentChannel,
} from "../links";
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
	/**
	 * A's procedures and documents in memory: `memory.client(key)` is what
	 * a Device calls, and `memory.documentChannel` with the key's token
	 * (`token`) what its link syncs.
	 */
	memory: MemoryHost;
	/** A's Space documents: its engine's. */
	documents: SpaceDocuments;
	/** A's flow documents: its engine's. */
	flows: FlowDocuments;
	/** Every document A syncs, by name. */
	synced: SyncedDocuments;
	/** A's id, as a Device names its Host. */
	hostId: string;
	/** A's owner: the Person of every Device that joins. */
	personId: string;
	/** A's answer to a Device with this key (`link.hello`). */
	hello(key: DeviceKeyAccess): Promise<HostHello>;
	/** A's registry takes a Device of A's owner, as pairing does: its key on A. */
	join(deviceId: string, name: string): Promise<DeviceKeyAccess>;
	/** The token a Device sends with its key: A's relay knows it once the Device joined. */
	token(key: DeviceKeyAccess): string;
	/**
	 * The Link of a Replica to A, as pairing leaves it: a `host_link` (A
	 * is its home Host) and the key's token in the Replica's file key
	 * store. Its address reaches nothing: the Host at an address is
	 * `memory.client(key)` and `memory.documentChannel`, as the Replica's
	 * runtime is told.
	 */
	link(
		replica: { db: Database; dataDir: string },
		key: DeviceKeyAccess,
	): Promise<void>;
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
 * `HostClient` (`inMemoryHost`), and its documents behind the document
 * channel, served as the daemon serves them (`servedDocuments`, with
 * `documentAccess`). It serves no pairing and no sessions: a Device joins
 * by hand (`join`, `link`), and its key is checked by its token alone. A's
 * own relay has no links.
 */
export async function hostInMemory(
	a: Sandbox,
	options: HostReplicaOptions = {},
): Promise<HostReplica> {
	const [owner] = await a.db.select().from(user);
	if (!owner) throw new Error("A has no owner.");
	const personId = owner.id;
	const hostId = a.deviceId;

	// A's documents. Its Space documents: the engine's, and where the Host records a Clone.
	const synced = createSyncedDocuments({ db: a.db });
	const documents = createSpaceDocuments({
		db: a.db,
		directory: deviceDirectory(a.db),
		documents: synced,
	});
	const flows = createFlowDocuments({ db: a.db, documents: synced });
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
		auth: noAuth,
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
	});
	/** The Device keys A knows, by their token: what `Host.syncKey` verifies. */
	const keys = new Map<string, SyncDeviceKey>();
	const token = (key: DeviceKeyAccess) => `nsd_memory-${key.deviceId}`;
	const memory = inMemoryHost({
		exchange: hostExchange,
		hello: asHost.hello,
		revoke: asHost.revoke,
		documents: servedDocuments({
			db: a.db,
			documents: synced,
			registry: host.devices,
			deviceKey: async (sent) => keys.get(sent) ?? null,
			sessions: {
				auth: noAuth,
				localSession: createLocalSession(noAuth, a.db, personId),
				ownerId: personId,
				isThisComputer: () => false,
			},
		}),
	});

	return {
		host,
		hostExchange,
		memory,
		documents,
		flows,
		synced,
		hostId,
		personId,
		hello: asHost.hello,
		token,
		async join(deviceId, name) {
			await host.devices.join({
				id: deviceId,
				name,
				platform: "test",
				ownerId: personId,
				// A is its home Host, as its link says (`link`).
				homeHost: "https://a.invalid",
			});
			const key: DeviceKeyAccess = {
				keyId: `key-${deviceId}`,
				deviceId,
				personId,
				permissions: {
					sync: ["pull", "push"],
					relay: ["serve"],
					archive: ["put", "get"],
				},
			};
			keys.set(token(key), { deviceId, personId, home: true });
			return key;
		},
		async link(replica, key) {
			await replica.db.insert(hostLink).values({
				hostId,
				name: "A",
				addresses: JSON.stringify(["http://127.0.0.1:9"]),
				role: "home",
				personId,
				keyStore: "file",
			});
			const stored = await deviceKeyStore({
				dataDir: replica.dataDir,
				prefer: "file",
			});
			await stored.set(hostId, token(key));
		},
	};
}

/** Better Auth for a Host that serves no pairing and no sessions: any use of it fails. */
const noAuth = new Proxy({} as Auth, {
	get() {
		throw new Error("Pairing and sessions are not served in memory.");
	},
});

/**
 * Links that are always online, one per Host: what a relay reads. They
 * run no streams: a test of the exchange starts its own `httpsLink`.
 * `inStep` asks the Host's document channel (`channels`), as a real link
 * does: a link without one cannot answer it.
 */
export function linksTo(
	clients: Map<string, HostClient>,
	channels: Map<string, ReturnType<OpenDocumentChannel>> = new Map(),
): DeviceLinks {
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
		async inStep(names, options = {}) {
			const channel = channels.get(hostId);
			if (!channel) {
				throw new Error("This link in memory syncs no documents.");
			}
			const end = Date.now() + (options.timeoutMs ?? 10_000);
			while (true) {
				if (channel.inStep(names)) return true;
				if (Date.now() >= end || options.signal?.aborted) return false;
				await Bun.sleep(20);
			}
		},
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
