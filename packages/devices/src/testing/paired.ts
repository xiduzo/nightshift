import type { Auth, DeviceKeyAccess } from "@nightshift/auth";
import { clone, hostLink, member, project, user } from "@nightshift/db/schema";
import {
	createFlowDocuments,
	createSettingsStore,
	createSpaceDocuments,
	type FlowDocuments,
	type SpaceDocuments,
} from "@nightshift/engine";
import {
	createRunLog,
	type Sandbox,
	type TestEngineOptions,
} from "@nightshift/engine/testing";
import { eq } from "drizzle-orm";
import type { HostClient } from "../contract";
import { createHostExchange, type HostExchange } from "../exchange";
import { createHost } from "../host";
import type { DeviceLinks, Link } from "../links";
import { createPeerEngine, deviceDirectory, type PeerEngine } from "../peers";
import { createRelay } from "../relay";
import { createWorkHub } from "../work";
import { inMemoryHost, type MemoryHost } from "./in-memory-host";
import { withPeers } from "./peers";

/** A Device paired with A: its engine, its key on A, and its copies of A's Spaces. */
export type PairedDevice = {
	/** The Device's engine: a Device of A's owner, paired with A. */
	engine: PeerEngine;
	/** Its Device key on A. */
	key: DeviceKeyAccess;
	/** Its Space documents: its read-only copies of A's Spaces. */
	documents: SpaceDocuments;
	/** Its flow documents: the engine's. */
	flows: FlowDocuments;
	/**
	 * Brings a project of A to the Device, as the Space document does.
	 * With `clone`, the Device has a folder of it too, so it can walk its
	 * runs.
	 */
	projectOnDevice(
		projectId: string,
		options?: { clone?: boolean },
	): Promise<void>;
};

/** Replica A as a Host and Replica B as its paired Device, in one process. */
export type PairedReplicas = {
	/** A's engine: the Host, and the Walker of its own runs. */
	host: PeerEngine;
	/** B's engine: a Device of A's owner, paired with A. */
	device: PeerEngine;
	/** A's exchange, as its API serves it. */
	hostExchange: HostExchange;
	/** A's procedures in memory: `memory.client(key)` is what B calls. */
	memory: MemoryHost;
	/** B's Device key on A. */
	key: DeviceKeyAccess;
	/** A's id, as B names its Host. */
	hostId: string;
	/** A's owner: B's Person on A. */
	personId: string;
	/** B's Space documents: its read-only copies of A's Spaces. */
	documents: SpaceDocuments;
	/** B's flow documents: its engine's. */
	flows: FlowDocuments;
	/** Brings a project of A to B (`PairedDevice.projectOnDevice`). */
	projectOnDevice: PairedDevice["projectOnDevice"];
	/** Pairs one more Device of A's owner with A, as B is: a third Replica. */
	pair(sandbox: Sandbox, name: string): Promise<PairedDevice>;
};

/**
 * Pairs B with A by hand, as pairing and the Host's documents would: B is
 * on A's registry with a key of A's owner, B keeps A's Spaces (a
 * `host_link`, the Host's Spaces, their Members mirrored into B's Space
 * documents), and each engine has its relay. B reaches A through `memory`
 * only: A's own relay has no links. `pair` adds another Device the same
 * way.
 */
export async function pairedReplicas(
	a: Sandbox,
	b: Sandbox,
	options: Partial<Pick<TestEngineOptions, "harnesses">> = {},
): Promise<PairedReplicas> {
	const harnesses = options.harnesses ?? {};
	const [owner] = await a.db.select().from(user);
	if (!owner) throw new Error("A has no owner.");
	const personId = owner.id;
	const hostId = a.deviceId;

	// A's Space documents: the engine's, and where the Host records a Clone.
	const hostDocuments = createSpaceDocuments({
		db: a.db,
		directory: deviceDirectory(a.db),
	});
	const host: PeerEngine = createPeerEngine(
		withPeers({
			db: a.db,
			harnesses,
			deviceId: a.deviceId,
			dataDir: a.dataDir,
			scheduler: false,
			spaceDocuments: hostDocuments,
			relay: createRelay({
				engine: () => host,
				registry: () => host.devices,
				links: () => linksTo(new Map()),
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
		documents: hostDocuments,
		registry: host.devices,
		selfId: a.deviceId,
		ownerId: personId,
		isHost: asHost.isHost,
		work: createWorkHub(),
	});
	const hello = asHost.hello;
	const memory = inMemoryHost({
		exchange: hostExchange,
		hello,
		revoke: asHost.revoke,
	});

	async function pair(sandbox: Sandbox, name: string): Promise<PairedDevice> {
		await host.devices.join({
			id: sandbox.deviceId,
			name,
			platform: "test",
			ownerId: personId,
			// A is its home Host, as its link says below.
			homeHost: "https://a.invalid",
		});
		const key: DeviceKeyAccess = {
			keyId: `key-${sandbox.deviceId}`,
			deviceId: sandbox.deviceId,
			personId,
			permissions: {
				sync: ["pull", "push"],
				relay: ["serve"],
				archive: ["put", "get"],
			},
		};
		const documents = createSpaceDocuments({
			db: sandbox.db,
			directory: deviceDirectory(sandbox.db),
		});
		const flows = createFlowDocuments({ db: sandbox.db });
		const engine: PeerEngine = createPeerEngine(
			withPeers({
				db: sandbox.db,
				harnesses,
				deviceId: sandbox.deviceId,
				dataDir: sandbox.dataDir,
				scheduler: false,
				spaceDocuments: documents,
				flowDocuments: flows,
				relay: createRelay({
					engine: () => engine,
					registry: () => engine.devices,
					links: () => linksTo(new Map([[hostId, memory.client(key)]])),
				}),
			}),
			{ runLog: createRunLog(sandbox.db, { walkerId: sandbox.deviceId }) },
		);

		// The Device keeps A's Spaces, as its link does with the Host's answer.
		await sandbox.db.insert(hostLink).values({
			hostId,
			name: "A",
			addresses: "[]",
			role: "home",
			personId,
			keyStore: "file",
		});
		const [local] = await sandbox.db.select().from(user);
		const listed = await hello(key);
		await engine.hostSpaces.update(
			{ id: hostId, name: "A" },
			listed.spaces,
			local?.id as string,
		);
		// Their Members, as the Space documents mirror them.
		for (const space of listed.spaces) {
			const members = await a.db
				.select({ id: user.id, name: user.name, role: member.role })
				.from(member)
				.innerJoin(user, eq(user.id, member.userId))
				.where(eq(member.organizationId, space.id));
			const document = await documents.open(space.id);
			document.doc.transact(() => {
				for (const m of members) {
					document.members.set(m.id, { name: m.name, role: m.role });
				}
			});
		}

		return {
			engine,
			key,
			documents,
			flows,
			async projectOnDevice(projectId, { clone: withClone = false } = {}) {
				const [row] = await a.db
					.select()
					.from(project)
					.where(eq(project.id, projectId));
				if (!row) throw new Error(`A has no project ${projectId}.`);
				await sandbox.db.insert(project).values(row);
				if (!withClone) return;
				await sandbox.db.insert(clone).values({
					id: `clone-${projectId}`,
					spaceId: row.spaceId,
					projectId,
					deviceId: sandbox.deviceId,
					path: sandbox.repoPath,
				});
			},
		};
	}

	const paired = await pair(b, "B");
	return {
		host,
		device: paired.engine,
		hostExchange,
		memory,
		key: paired.key,
		hostId,
		personId,
		documents: paired.documents,
		flows: paired.flows,
		projectOnDevice: paired.projectOnDevice,
		pair,
	};
}

/** Better Auth for a Host that serves no pairing: any use of it fails. */
const noPairing = new Proxy({} as Auth, {
	get() {
		throw new Error("Pairing is not served in memory.");
	},
});

/**
 * Links that are always online, one per Host: what a relay reads. They
 * run no streams: a test of the exchange starts its own `httpsLink`.
 */
function linksTo(clients: Map<string, HostClient>): DeviceLinks {
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
		synced: () => true,
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
