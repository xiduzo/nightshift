import { type DeviceKeyAccess, spacesOf } from "@nightshift/auth";
import { clone, hostLink, member, project, user } from "@nightshift/db/schema";
import { createSpaceDocuments, type SpaceDocuments } from "@nightshift/engine";
import {
	createRunLog,
	type Sandbox,
	type TestEngineOptions,
} from "@nightshift/engine/testing";
import { eq } from "drizzle-orm";
import type { HostClient, HostHello } from "../contract";
import { createHostExchange, type HostExchange } from "../exchange";
import type { DeviceLinks } from "../links";
import { createPeerEngine, deviceDirectory, type PeerEngine } from "../peers";
import { createRelay } from "../relay";
import { createWorkHub } from "../work";
import { inMemoryHost, type MemoryHost } from "./in-memory-host";
import { withPeers } from "./peers";

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
	/**
	 * Brings a project of A to B, as the Space document does. With
	 * `clone`, B has a folder of it too, so B can walk its runs.
	 */
	projectOnDevice(
		projectId: string,
		options?: { clone?: boolean },
	): Promise<void>;
};

/**
 * Pairs B with A by hand, as pairing and the Host's documents would: B is
 * on A's registry with a key of A's owner, B keeps A's Spaces (a
 * `host_link`, the Host's Spaces, their Members mirrored into B's Space
 * documents), and each engine has its relay. B reaches A through `memory`
 * only: A's own relay has no links.
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

	const host: PeerEngine = createPeerEngine(
		withPeers({
			db: a.db,
			harnesses,
			deviceId: a.deviceId,
			dataDir: a.dataDir,
			scheduler: false,
			relay: createRelay({
				engine: () => host,
				registry: () => host.devices,
				links: () => linksTo(new Map()),
			}),
		}),
		{ runLog: createRunLog(a.db, { walkerId: a.deviceId }) },
	);
	await host.devices.join({
		id: b.deviceId,
		name: "B",
		platform: "test",
		ownerId: personId,
		homeHost: null,
	});
	const hostExchange = createHostExchange({
		db: a.db,
		engine: host,
		registry: host.devices,
		selfId: a.deviceId,
		ownerId: personId,
		isHost: () => true,
		work: createWorkHub(),
	});
	const key: DeviceKeyAccess = {
		keyId: "key-b",
		deviceId: b.deviceId,
		personId,
		permissions: {
			sync: ["pull", "push"],
			relay: ["serve"],
			archive: ["put", "get"],
		},
	};

	async function hello(access: DeviceKeyAccess): Promise<HostHello> {
		const paired = await host.devices.get(access.deviceId);
		if (!paired || paired.revokedAt) {
			throw new Error("This device has no access here. Pair it again.");
		}
		await host.devices.seen(access.deviceId);
		return {
			host: { id: hostId, name: "A", addresses: [] },
			deviceId: access.deviceId,
			personId: access.personId,
			spaces: await spacesOf(a.db, access.personId),
		};
	}
	const memory = inMemoryHost({ exchange: hostExchange, hello });

	const documents = createSpaceDocuments({
		db: b.db,
		directory: deviceDirectory(b.db),
	});
	const device: PeerEngine = createPeerEngine(
		withPeers({
			db: b.db,
			harnesses,
			deviceId: b.deviceId,
			dataDir: b.dataDir,
			scheduler: false,
			spaceDocuments: documents,
			relay: createRelay({
				engine: () => device,
				registry: () => device.devices,
				links: () => linksTo(new Map([[hostId, memory.client(key)]])),
			}),
		}),
		{ runLog: createRunLog(b.db, { walkerId: b.deviceId }) },
	);

	// B keeps A's Spaces, as its link does with the Host's answer.
	await b.db.insert(hostLink).values({
		hostId,
		name: "A",
		addresses: "[]",
		role: "home",
		personId,
		keyStore: "file",
	});
	const [local] = await b.db.select().from(user);
	const listed = await hello(key);
	await device.exchange.hostSpaces.update(
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
		host,
		device,
		hostExchange,
		memory,
		key,
		hostId,
		personId,
		documents,
		async projectOnDevice(projectId, { clone: withClone = false } = {}) {
			const [row] = await a.db
				.select()
				.from(project)
				.where(eq(project.id, projectId));
			if (!row) throw new Error(`A has no project ${projectId}.`);
			await b.db.insert(project).values(row);
			if (!withClone) return;
			await b.db.insert(clone).values({
				id: `clone-${projectId}`,
				spaceId: row.spaceId,
				projectId,
				deviceId: b.deviceId,
				path: b.repoPath,
			});
		},
	};
}

/** Links that are always online, one per Host: what a relay reads. */
function linksTo(clients: Map<string, HostClient>): DeviceLinks {
	const linkOf = (hostId: string, client: HostClient) => ({
		hostId,
		state: () => ({
			status: "online" as const,
			address: "memory",
			since: 0,
		}),
		client: () => client,
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
