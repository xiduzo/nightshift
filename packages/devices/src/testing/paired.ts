import type { DeviceKeyAccess } from "@nightshift/auth";
import { user } from "@nightshift/db/schema";
import {
	createFlowDocuments,
	createSyncedDocuments,
	type FlowDocuments,
	HostUnreachableError,
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
	type TestEngineOptions,
} from "@nightshift/engine/testing";
import { now as timeNow } from "@nightshift/time";
import type { HostRelay, WorkRelay } from "../contract";
import type { HostExchange } from "../exchange";
import type { SyncedDocument } from "../links";
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
	/**
	 * Brings a project of A to the Device, as its Link does: A's Space
	 * document (every project of the Space) syncs to it, its rows follow,
	 * and then the project's flow and knowledge documents sync. From then
	 * on they stay in step by themselves, over A's document channel in
	 * memory. With `clone`, the Device adds its folder of the repository
	 * too (A records the Clone), so it can walk its runs.
	 */
	projectOnDevice(
		projectId: string,
		options?: { clone?: boolean },
	): Promise<void>;
	/**
	 * The Device's documents in step with A, as its Link syncs them on
	 * each answer of A: the documents of the Spaces A keeps for it, and
	 * of the Projects they list. Resolves once they are in step.
	 */
	syncWithHost(): Promise<void>;
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
	/** Every document A syncs, by name: what A's document channel serves. */
	hostSynced: SyncedDocuments;
	/** A's procedures and documents in memory: `memory.client(key)` is what B calls. */
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
	/** Brings a project of A to B (`PairedDevice.projectOnDevice`). */
	projectOnDevice: PairedDevice["projectOnDevice"];
	/** B's documents in step with A (`PairedDevice.syncWithHost`). */
	syncWithHost: PairedDevice["syncWithHost"];
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
 * Pairs B with A by hand, as pairing would: A is a Host in memory
 * (`hostInMemory`), B is on A's registry with a key of A's owner, B keeps
 * A's Spaces (a `host_link`, the Host's Spaces), and each engine has its
 * relay. B reaches A through `memory` only, its procedures and its
 * documents: A's own relay has no links. `pair` adds another Device the
 * same way.
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
		// The Device's link to A syncs its documents over A's channel in memory.
		const channel = memory.documentChannel({
			address: "memory",
			key: replica.token(key),
			certificate: null,
			closed: () => {},
		});
		const relay = createRelay({
			engine: () => engine,
			registry: () => engine.devices,
			links: () =>
				linksTo(
					new Map([[hostId, memory.client(key)]]),
					new Map([[hostId, channel]]),
				),
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
		await replica.link(sandbox, key);
		const [local] = await sandbox.db.select().from(user);
		const listed = await hello(key);
		await engine.hostSpaces.update(
			{ id: hostId, name: "A" },
			listed.spaces,
			local?.id as string,
		);

		/**
		 * What the link syncs on each answer of A: the documents of each
		 * Space A keeps for the Device, and of its Projects here. A Project
		 * comes with the Space document's rows, so it syncs again until the
		 * list stays the same. The Device's own document does not sync in
		 * memory.
		 */
		async function syncWithHost() {
			let before = "";
			for (let round = 0; round < 5; round++) {
				const listed: SyncedDocument[] = [];
				for (const spaceId of await engine.hostSpaces.ofHost(hostId)) {
					for (const document of await synced.ofSpace(spaceId)) {
						listed.push({ name: document.name, doc: document.doc });
					}
				}
				channel.sync(listed);
				const names = listed.map((document) => document.name);
				const end = timeNow() + 10_000;
				while (!channel.inStep(names)) {
					if (timeNow() >= end) {
						throw new Error(`${name}'s documents are not in step with A.`);
					}
					await Bun.sleep(5);
				}
				// Their rows follow them.
				await synced.flush();
				const now = names.join(",");
				if (now === before) return;
				before = now;
			}
		}

		return {
			engine,
			log,
			key,
			documents,
			flows,
			synced,
			async projectOnDevice(projectId, { clone: withClone = false } = {}) {
				const { remote } = await host.projects.find(projectId);
				await syncWithHost();
				if (!withClone) return;
				if (remote !== PAIRED_REMOTE) {
					throw new Error(
						`A's project ${projectId} is not of A's repository: the Device has no folder of it.`,
					);
				}
				const { spaceId } = await host.projects.find(projectId);
				await engine.space(spaceId).addProject({ repoPath: sandbox.repoPath });
				// The Clone's import marks the flows: the link brings that to A.
				await syncWithHost();
			},
			syncWithHost,
		};
	}

	const paired = await pair(b, "B");
	return {
		host,
		device: paired.engine,
		deviceLog: paired.log,
		hostExchange,
		hostSynced: replica.synced,
		memory,
		key: paired.key,
		hostId,
		personId,
		documents: paired.documents,
		flows: paired.flows,
		synced: paired.synced,
		syncWithHost: paired.syncWithHost,
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
