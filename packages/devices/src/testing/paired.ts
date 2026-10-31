import type { DeviceKeyAccess } from "@nightshift/auth";
import { member, user } from "@nightshift/db/schema";
import {
	createFlowDocuments,
	createSyncedDocuments,
	type FlowDocuments,
	HostUnreachableError,
	type KnowledgeHost,
	type SyncedDocuments,
} from "@nightshift/engine";
import {
	createSpaceDocuments,
	type SpaceDocuments,
} from "@nightshift/engine/projects";
import {
	createRunLog,
	mustGit,
	type RunLog,
	type Sandbox,
	syncSpaceDocument,
	type TestEngineOptions,
} from "@nightshift/engine/testing";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { createKnowledgeArchive } from "../archive";
import type { HostRelay, WorkRelay } from "../contract";
import type { HostExchange } from "../exchange";
import { createPeerEngine, deviceDirectory, type PeerEngine } from "../peers";
import { createRelay } from "../relay";
import { hostInMemory, linksTo } from "./host-in-memory";
import type { MemoryHost } from "./in-memory-host";
import { withPeers } from "./peers";

/** The `origin` of A's repository and of each paired Device's copy of it. */
const PAIRED_ORIGIN = "https://github.com/nightshift-test/paired.git";
/** That `origin` as a Project's remote. */
const PAIRED_REMOTE = "github.com/nightshift-test/paired";

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
	/** Every document it syncs, by name: the views above are over them. */
	synced: SyncedDocuments;
	/** A's archive of knowledge content, as the Device reaches it over its relay. */
	knowledge: KnowledgeHost;
	/**
	 * Brings a project of A to the Device, as its Link does: A's Space
	 * document (every project of the Space) syncs to it, and its rows
	 * follow. With `clone`, the Device adds its folder of the repository
	 * too (A records the Clone), so it can walk its
	 * runs.
	 */
	projectOnDevice(
		projectId: string,
		options?: { clone?: boolean },
	): Promise<void>;
	/**
	 * Brings the Device's changes of a project's flows to A, as its Link
	 * does. Its relay waits for this before a run starts on A: nothing
	 * syncs in memory by itself.
	 */
	flowsToHost(projectId: string): Promise<void>;
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
	/** Every document B syncs, by name (`PairedDevice.synced`). */
	synced: SyncedDocuments;
	/** A's archive of knowledge content, as B reaches it (`PairedDevice.knowledge`). */
	knowledge: KnowledgeHost;
	/** Brings a project of A to B (`PairedDevice.projectOnDevice`). */
	projectOnDevice: PairedDevice["projectOnDevice"];
	/** Brings B's changes of a project's flows to A (`PairedDevice.flowsToHost`). */
	flowsToHost: PairedDevice["flowsToHost"];
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
	// A's repository, and each Device's copy of it: one remote.
	await mustGit(a.repoPath, ["remote", "add", "origin", PAIRED_ORIGIN]);
	const replica = await hostInMemory(a, {
		harnesses,
		...(options.hostWork ? { hostWork: options.hostWork } : {}),
	});
	const { host, hostExchange, memory, hostId, personId, hello } = replica;

	async function pair(sandbox: Sandbox, name: string): Promise<PairedDevice> {
		await mustGit(sandbox.repoPath, ["remote", "add", "origin", PAIRED_ORIGIN]);
		const key = await replica.join(sandbox.deviceId, name);
		const synced = createSyncedDocuments({ db: sandbox.db });
		const documents = createSpaceDocuments({
			db: sandbox.db,
			directory: deviceDirectory(sandbox.db),
			documents: synced,
		});
		const flows = createFlowDocuments({ db: sandbox.db, documents: synced });
		const log = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
		const relay = createRelay({
			engine: () => engine,
			registry: () => engine.devices,
			links: () =>
				linksTo(new Map([[hostId, memory.client(key)]]), {
					here: async (name) => (await synced.find(name))?.doc ?? null,
					host: async (name) => (await replica.synced.find(name))?.doc ?? null,
				}),
			flows,
		});
		const engine: PeerEngine = createPeerEngine(
			withPeers({
				db: sandbox.db,
				harnesses,
				deviceId: sandbox.deviceId,
				dataDir: sandbox.dataDir,
				scheduler: false,
				spaceDocuments: documents,
				flowDocuments: flows,
				relay: startsOnHost(relay, options.hostWalks ?? false),
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

		async function flowsToHost(projectId: string) {
			const here = await flows.open(projectId);
			const there = await replica.flows.open(projectId);
			for (const part of ["current", "history"] as const) {
				Y.applyUpdate(there[part].doc, Y.encodeStateAsUpdate(here[part].doc));
				await there[part].flush();
			}
		}

		return {
			engine,
			log,
			key,
			documents,
			flows,
			synced,
			knowledge: createKnowledgeArchive({ relay }),
			async projectOnDevice(projectId, { clone: withClone = false } = {}) {
				const { spaceId, remote } = await host.projects.find(projectId);
				await syncSpaceDocument(replica.documents, documents, spaceId);
				if (!withClone) return;
				if (remote !== PAIRED_REMOTE) {
					throw new Error(
						`A's project ${projectId} is not of A's repository: the Device has no folder of it.`,
					);
				}
				await engine.space(spaceId).addProject({ repoPath: sandbox.repoPath });
				// The Clone's import marks the flows: the Link brings that to A.
				await flowsToHost(projectId);
			},
			flowsToHost,
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
		synced: paired.synced,
		flowsToHost: paired.flowsToHost,
		knowledge: paired.knowledge,
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
