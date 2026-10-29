import type { DeviceKeyAccess } from "@nightshift/auth";
import { clone, member, project, user } from "@nightshift/db/schema";
import {
	createFlowDocuments,
	type FlowDocuments,
	HostUnreachableError,
} from "@nightshift/engine";
import {
	createSpaceDocuments,
	type SpaceDocuments,
} from "@nightshift/engine/projects";
import {
	createRunLog,
	type RunLog,
	type Sandbox,
	type TestEngineOptions,
} from "@nightshift/engine/testing";
import { eq } from "drizzle-orm";
import type { HostRelay, WorkRelay } from "../contract";
import type { HostExchange } from "../exchange";
import { createPeerEngine, deviceDirectory, type PeerEngine } from "../peers";
import { createRelay } from "../relay";
import { hostInMemory, linksTo } from "./host-in-memory";
import type { MemoryHost } from "./in-memory-host";
import { withPeers } from "./peers";

/** A Device paired with A: its engine, its key on A, and its copies of A's Spaces. */
export type PairedDevice = {
	/** The Device's engine: a Device of A's owner, paired with A. */
	engine: PeerEngine;
	/** Its engine's run log: a test that writes events by hand tells it to read them. */
	log: RunLog;
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
	/** B's run log (`PairedDevice.log`). */
	deviceLog: RunLog;
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

/** How the paired Replicas behave. */
export type PairedOptions = Partial<Pick<TestEngineOptions, "harnesses">> & {
	/**
	 * A run a Device starts goes to A, which walks it (ADR 1). Default:
	 * A does not take run starts, so a Device walks the runs it starts
	 * itself, as when it cannot reach its Host. The steps of a run A walks
	 * need a work relay to the Device, which these Replicas do not run.
	 */
	hostWalks?: boolean;
	/** How A's calls reach its paired Devices. Default: they reach none. */
	hostWork?: WorkRelay;
};

/**
 * Pairs B with A by hand, as pairing and the Host's documents would: A is
 * a Host in memory (`hostInMemory`), B is on A's registry with a key of
 * A's owner, B keeps A's Spaces (a `host_link`, the Host's Spaces, their
 * Members mirrored into B's Space documents), and each engine has its
 * relay. B reaches A through `memory` only: A's own relay has no links.
 * `pair` adds another Device the same way.
 */
export async function pairedReplicas(
	a: Sandbox,
	b: Sandbox,
	options: PairedOptions = {},
): Promise<PairedReplicas> {
	const harnesses = options.harnesses ?? {};
	const replica = await hostInMemory(a, {
		harnesses,
		...(options.hostWork ? { hostWork: options.hostWork } : {}),
	});
	const { host, hostExchange, memory, hostId, personId, hello } = replica;

	async function pair(sandbox: Sandbox, name: string): Promise<PairedDevice> {
		const key = await replica.join(sandbox.deviceId, name);
		const documents = createSpaceDocuments({
			db: sandbox.db,
			directory: deviceDirectory(sandbox.db),
		});
		const flows = createFlowDocuments({ db: sandbox.db });
		const log = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
		const engine: PeerEngine = createPeerEngine(
			withPeers({
				db: sandbox.db,
				harnesses,
				deviceId: sandbox.deviceId,
				dataDir: sandbox.dataDir,
				scheduler: false,
				spaceDocuments: documents,
				flowDocuments: flows,
				relay: startsOnHost(
					createRelay({
						engine: () => engine,
						registry: () => engine.devices,
						links: () => linksTo(new Map([[hostId, memory.client(key)]])),
						flows,
					}),
					options.hostWalks ?? false,
				),
			}),
			{ runLog: log },
		);

		// The Device keeps A's Spaces, as its link does with the Host's answer.
		await replica.link(sandbox);
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
			log,
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
		deviceLog: paired.log,
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

/**
 * A Device's relay, whose run starts reach the Host only when it walks
 * them: else the Host is out of reach for a start, and the Device walks it.
 */
function startsOnHost(relay: HostRelay, hostWalks: boolean): HostRelay {
	if (hostWalks) return relay;
	return {
		...relay,
		async reachable() {
			return false;
		},
		async startRun() {
			throw new HostUnreachableError();
		},
	};
}
