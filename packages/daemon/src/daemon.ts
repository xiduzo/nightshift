import { join } from "node:path";
import { startPriceUpdates } from "@nightshift/agents";
import type { Context } from "@nightshift/api/context";
import {
	databaseUrl,
	ensureDataDir,
	resolveDataDir,
} from "@nightshift/db/data-dir";
import { migrateDb } from "@nightshift/db/migrate";
import type { HostClient, OpenDocumentChannel } from "@nightshift/devices";
import {
	createSyncedDocuments,
	killStartedOllama,
	type PersonalSecrets,
	type ProjectSecrets,
} from "@nightshift/engine";
import { createTelemetry } from "@nightshift/telemetry";
import { instant } from "@nightshift/time";
import { reportDeviceFacts } from "./agents";
import { createHttp, type DaemonServe, trustedOriginsOf } from "./http";
import {
	createKeepAwake,
	engineRunSource,
	type SleepLock,
	systemSleepLock,
} from "./keep-awake";
import type { DesktopScreen } from "./notifications";
import {
	afterStops,
	type DaemonEnv,
	daemonAuthSecret,
	daemonPort,
	guardProcess,
	holdLease,
	hot,
	hotSlots,
	lastingStop,
	oneStartAtATime,
	onProcessCrashed,
	processDatabase,
	stopOnSignals,
} from "./runtime";
import { usageFacts } from "./telemetry";
import { wireDaemonAccess } from "./wire-access";
import { wireDaemonAssistant } from "./wire-assistant";
import { openOwner, wireDaemonAuth } from "./wire-auth";
import { openDeviceConfig, wireDaemonConfig, wireSetups } from "./wire-config";
import { openRegistry, wireDaemonDevices } from "./wire-devices";
import { followRunLearnings, wireDaemonKnowledge } from "./wire-knowledge";
import { wireLocalDevice } from "./wire-local";
import {
	notificationMoves,
	wireDaemonNotifications,
} from "./wire-notifications";
import { wireDaemonProjects, wireProjectCopies } from "./wire-projects";

export type DaemonOptions = {
	/** The port the daemon listens on: its own addresses may call it. Default: PORT, else DEFAULT_PORT. */
	port?: number;
	/** How the pi harness starts pi-acp: the `nightshift` binary runs itself. Default: pi-acp's own script. */
	piAcp?: string[];
	/** The migrations folder: the binary extracts its own. Default: the one of `@nightshift/db`. */
	migrationsFolder?: string;
	/**
	 * How this computer shows its desktop notifications. The desktop app
	 * passes Electrobun's, with its window. "system": the OS programs
	 * (`systemDesktopNotifier`), unless NIGHTSHIFT_DESKTOP_NOTIFICATIONS is
	 * off. Default: none.
	 */
	desktop?: DesktopScreen | "system";
	/** What the daemon reaches outside this process at start. A test gives its own. */
	outside?: DaemonOutside;
};

/** The network and the OS, as a daemon reaches them by itself (`DaemonOptions.outside`). */
export type DaemonOutside = {
	/** Fetches the newer price list once a day. Default: `fetch`. */
	fetch?: (url: string, init?: RequestInit) => Promise<Response>;
	/** The OS's sleep lock, or null for none. Default: `systemSleepLock`. */
	sleepLock?: SleepLock | null;
	/**
	 * The Host at an address, as this computer's Links call it. Default:
	 * over HTTPS, with the Link's key and its pinned certificate.
	 */
	hosts?: (address: string) => HostClient;
	/**
	 * The documents of the Hosts, as this computer's Links sync them.
	 * Default: Hocuspocus to each Host's relay.
	 */
	documents?: OpenDocumentChannel;
};

/** Facts about this daemon that change only on a restart. */
export type DaemonInfo = Context["daemon"] & {
	databaseUrl: string;
	/** The lease this daemon holds. */
	leaseOwner: string;
	/** Whom this daemon answers since it started: this computer, or the network. */
	reach: "this-computer" | "network";
};

/** One daemon: what Bun serves, what it is, and how it stops. */
export type Daemon = DaemonServe & {
	info: DaemonInfo;
	/** Whether the Person who owns this computer has a sign-in for a browser elsewhere. */
	ownerHasLogin(): Promise<boolean>;
	/**
	 * A clean stop: stops the work of this daemon, writes what the Device,
	 * Space and flow documents still have pending, and gives the lease up,
	 * so the next daemon starts at once. Bounded at 2 s. Never throws.
	 */
	stop(): Promise<void>;
	/**
	 * Calls `listener` with the time of each lease heartbeat the database
	 * took: the desktop watchdog's sign that this daemon's timers still run.
	 */
	onLeaseHeartbeat(listener: (at: number) => void): () => void;
};

/**
 * The daemon's composition root: every service of one daemon, wired. It
 * holds the database lease, opens the documents, starts the devices with
 * the engine (`startDevices`) and the timers, and returns what Bun
 * serves. It does not listen: `startDaemon` does. One per process: `bun
 * --hot` calls it again on each reload, and each piece that must have one
 * owner names its slot and lifecycle here (`hotSlots`, `runtime/hot.ts`).
 * Two reloads at once start one after the other (`oneStartAtATime`). A
 * first start that fails gives the lease up.
 *
 * The blocks of a capability are in `wire-*.ts` beside this file: auth,
 * config, devices, knowledge, notifications and projects. A lane of the
 * hexagon series edits its block, not this file. This file keeps the
 * order in which the blocks start.
 */
export function createDaemon(
	env: DaemonEnv,
	options: DaemonOptions = {},
): Promise<Daemon> {
	return oneStartAtATime(hot, async () => {
		// A stop that gave up at its bound goes on, and would end this start's
		// slots (its lease too): wait until it ended.
		await afterStops();
		// No lease in this process yet: no listener of a daemon before answers.
		const first = hot.nightshiftLease === undefined;
		try {
			return await makeDaemon(env, options);
		} catch (error) {
			// A first start that fails stops what it started and gives the lease
			// up, so the next start does not wait for it. A reload that fails
			// keeps it: the listeners of the daemon before still answer.
			if (first) await hot.nightshiftStop?.();
			throw error;
		}
	});
}

async function makeDaemon(
	env: DaemonEnv,
	options: DaemonOptions,
): Promise<Daemon> {
	// First: an error nothing caught must never stop the timers (the lease
	// heartbeat, the scheduler). `nightshift serve` also exits on one.
	guardProcess();
	const port = options.port ?? daemonPort();
	const outside = options.outside ?? {};

	/** The database, the transcripts and the command logs, together. */
	const dev = env.NIGHTSHIFT_DEV === "true";
	const dataDir = ensureDataDir(
		resolveDataDir({
			NIGHTSHIFT_DATA_DIR: env.NIGHTSHIFT_DATA_DIR,
			NIGHTSHIFT_DEV: dev,
		}),
	);
	// Before anything else: production refuses to start without a secret.
	const authSecret = daemonAuthSecret(env, dataDir);

	const url = databaseUrl(env, dataDir);
	// One client per process: a `bun --hot` reload takes the one it has.
	const db = processDatabase(url);
	await migrateDb(db, { migrationsFolder: options.migrationsFolder });

	const slots = hotSlots(hot);
	const stop = lastingStop(() => slots.stop());
	stopOnSignals(stop, killStartedOllama);
	const lease = await slots.keep(
		"nightshiftLease",
		() => holdLease(db),
		(held) => held.release(),
	);

	/**
	 * Every document this Replica syncs, by name: this Device's, the Space
	 * documents, and each Project's flow and knowledge documents (ADR 2,
	 * ADR 4). One writer each per process: kept across reloads.
	 */
	const documents = await slots.keep(
		"nightshiftDocuments",
		async () => {
			return createSyncedDocuments({
				db,
				onStored: (document) => tellDocument(document.name),
			});
		},
		(kept) => kept.flush(),
	);
	// A block that needs what a later block makes gets a function that
	// reads it when called. Each `let` below is set once that block exists.
	/** Tells the open screens; set once the notifications below exist. */
	let projectsChanged: (spaceId: string) => void = () => {};
	/** A synced document was written. Set once the notifications below exist. */
	let tellDocument: (name: string) => void = () => {};
	const registry = openRegistry(db, { dev });
	const projects = wireDaemonProjects({
		db,
		documents,
		directory: registry.directory,
		// Read only when a project's folder is asked for, after the Device below.
		selfId: async () => device.id,
		projectsChanged: (spaceId) => projectsChanged(spaceId),
	});
	const { spaces, flows, clonePath } = projects;

	const trustedOrigins = trustedOriginsOf(env, port);
	/** Whether this computer is a Host, and its addresses, once the settings below exist. */
	let hostSettings: () => { host: boolean; hostAddresses: readonly string[] } =
		() => ({ host: false, hostAddresses: [] });
	const { auth, hostPolicy, spaceIds } = wireDaemonAuth({
		env,
		db,
		port,
		authSecret,
		onMembersChanged: (spaceId) => spaces.mirrorMembers(spaceId),
		onMemberChange: (change) => engine.logMemberChange(change),
		hostSettings: () => hostSettings(),
	});

	/** This computer's Device: the Walker of its runs, the owner of its Clones. */
	const device = await registry.self();
	const document = await openDeviceConfig({
		db,
		deviceId: device.id,
		documents,
	});
	/** The Person who owns this computer, and their personal Space. */
	const owner = await openOwner({ db, auth, self: registry.owner });
	const { person, localSession } = owner;
	const { access, computerAccess } = wireDaemonAccess({
		db,
		spaces,
		ownerId: person.userId,
	});

	// Every Space's document, before the relay serves them: the Projects of a
	// Replica from before them are imported here, once.
	await documents.openAll();

	/** The Personal secrets and the Projects' secrets (ADR 13): the devices below give them. */
	let personalSecrets: PersonalSecrets | null = null;
	let projectSecrets: ProjectSecrets | null = null;
	const { config, keyStore, toolLaunchers } = await wireDaemonConfig({
		computerAccess,
		access,
		env,
		dataDir,
		document,
		personal: () => personalSecrets,
		projects: () => projectSecrets,
	});
	const { settings, connections, profiles } = config;
	hostSettings = () => settings.current();

	await slots.replace(
		"nightshiftFacts",
		() =>
			reportDeviceFacts({
				db,
				document,
				deviceId: device.id,
				name: device.name,
				settings,
			}),
		(timer) => clearInterval(timer),
	);

	// Only the newest engine may start scheduled runs: the one before stops
	// its scheduler.
	const scheduler = await slots.replace(
		"nightshiftScheduler",
		() => new AbortController(),
		(before) => before.abort(),
	);

	/**
	 * "Send runs to your monitoring" (this computer's setting, off by
	 * default): its Claude Code sessions' own telemetry, and once it
	 * follows the engine below, the runs it walks as OpenTelemetry spans
	 * and metrics. It follows the setting and the secrets of its headers
	 * itself.
	 */
	let usageSnapshot:
		| (() => Promise<{
				agents: number;
				phone: boolean;
				paired: boolean;
				spaces: number;
				members: number;
		  } | null>)
		| null = null;
	const telemetry = await slots.replace(
		"nightshiftTelemetry",
		() =>
			createTelemetry({
				deviceId: device.id,
				db,
				settings,
				secrets: connections,
				usageSnapshot: () => usageSnapshot?.() ?? Promise.resolve(null),
			}),
		(before) => before.stop(),
	);

	/** Tells the open screens; set once the notifications below exist. */
	let learningsChanged: (spaceId: string, projectId: string) => Promise<void> =
		async () => {};
	const { ollama, archive, knowledge } = await wireDaemonKnowledge({
		env,
		slots,
		db,
		dataDir,
		documents,
		access,
		device,
		usage: telemetry,
		settings,
		secrets: connections,
		learningsChanged: (spaceId, projectId) =>
			learningsChanged(spaceId, projectId),
	});
	/** The engine, once `startDevices` made it: a restore that asks before then waits for it. */
	const madeEngine =
		Promise.withResolvers<Pick<typeof engine, "keptWorkGone">>();
	const { harnesses, decider, local } = wireLocalDevice({
		computerAccess,
		keptWorkGone: async (run) => (await madeEngine.promise).keptWorkGone(run),
		id: device.id,
		name: device.name,
		config,
		dataDir,
		piAcp: options.piAcp,
		toolLaunchers,
		clonePath,
		knowledge,
		telemetry,
		ollama,
		// The engine's flows (made below, before anyone can ask).
	});

	/**
	 * The price list that prices tokens when a harness reports no cost: the
	 * bundled one, then a newer one fetched once a day into the data folder.
	 * Not awaited: the daemon starts on the bundled list, never on the network.
	 * A stop aborts the fetch and waits for it: one writer of the list.
	 */
	const fetchPrices = outside.fetch ?? fetch;
	void slots
		.replace(
			"nightshiftPrices",
			(stopped) =>
				startPriceUpdates({
					file: join(dataDir, "prices.json"),
					fetch: (url, init) => fetchPrices(url, { ...init, signal: stopped }),
					onError: (error) => {
						if (stopped.aborted) return;
						console.warn("The price list was not updated:", error);
					},
				}),
			(before) => before.stop(),
		)
		.catch((error) => console.warn("The price list was not updated:", error));

	const { devices, sync } = await wireDaemonDevices({
		dev,
		env,
		slots,
		auth,
		db,
		settings,
		profiles,
		document,
		documents,
		spaces,
		flows,
		self: device,
		ownerId: person.userId,
		local,
		dataDir,
		archive,
		keyStore,
		connections,
		scheduler,
		usage: telemetry,
		moveRows: [notificationMoves(db, settings, person)],
		// A moved Project's knowledge follows it, to its new id when it has one.
		projectsMoved: (move) => knowledge.moved(move),
		hosts: outside.hosts,
		documentChannel: outside.documents,
		sessions: {
			auth,
			localSession,
			ownerId: person.userId,
			policy: hostPolicy,
		},
		trustedOrigins,
		started: (started) => {
			madeEngine.resolve(started.engine);
			personalSecrets = started.personalSecrets;
			projectSecrets = started.projectSecrets;
			knowledge.connect({
				inStep: started.inStep,
				// The Spaces with no Host: this Replica keeps their knowledge content.
				keeps: async (spaceId) =>
					(await started.engine.hostSpaces.hostOf(spaceId)) === null,
			});
		},
	});
	const { engine } = devices;

	const screens = await wireDaemonNotifications({
		db,
		auth,
		env,
		engine,
		settings,
		device,
		owner: person,
		desktop: options.desktop,
		slots,
		documents,
	});
	const { notifications } = screens;
	projectsChanged = screens.projectsChanged;
	tellDocument = screens.tellDocument;
	learningsChanged = screens.learningsChanged;
	usageSnapshot = () =>
		usageFacts({
			db,
			settings,
			listScreens: (personId) => notifications.targets.kindsOf(personId),
			devices: devices.devices,
			ownerId: person.userId,
		});
	// Runs this computer walks go to monitoring while that export is on.
	// Anonymous usage follows the same engine, including the Space policy.
	telemetry.follow(engine);
	telemetry.note({
		kind: "install-started",
		entry: options.desktop ? "desktop" : "server",
		host: settings.current().host,
	});
	onProcessCrashed(() => {
		telemetry.note({ kind: "process-crashed" });
	});

	/**
	 * "Keep this computer awake" (this computer's
	 * setting): the OS's sleep lock while a run here needs it.
	 */
	const keepAwake = await slots.replace(
		"nightshiftKeepAwake",
		() =>
			createKeepAwake({
				enabled: () => settings.current().keepAwake,
				runs: engineRunSource(engine, () => spaceIds()),
				lock:
					outside.sleepLock !== undefined
						? outside.sleepLock
						: systemSleepLock(),
			}),
		(before) => before.stop(),
	);
	// Not awaited: it reads the runs that have not ended.
	void keepAwake.start();

	const projectSetup = await wireProjectCopies({
		computerAccess,
		slots,
		dataDir,
		spaceIds: () => spaceIds(),
		space: (spaceId, actor) => engine.space(spaceId, actor),
		settings,
		usage: telemetry,
	});

	// The Space view for the session's Person: these calls come behind the API.
	const asked = (at: { spaceId: string; personId: string }) =>
		engine.space(at.spaceId, { personId: at.personId, door: "session" });
	const setups = await wireSetups({
		computerAccess,
		slots,
		config,
		toolLaunchers,
		deviceId: device.id,
		space: (at) => engine.space(at.spaceId, at.actor),
		ollama,
		usage: telemetry,
	});

	const info: DaemonInfo = {
		dataDir,
		device: { ...device, ownerId: person.userId },
		lease: {
			host: lease.host,
			pid: lease.pid,
			epoch: lease.epoch,
			since: instant(lease.since),
		},
		databaseUrl: url,
		leaseOwner: lease.owner,
		reach: devices.reach,
	};

	const assistant = wireDaemonAssistant({
		config,
		harnesses,
		decider,
		dataDir,
		clonePath,
		withoutFolder: projects.withoutFolder,
		space: asked,
		engine,
		personId: person.userId,
	});
	await followRunLearnings({
		slots,
		runs: engine,
		knowledge,
		learner: assistant.learner,
	});

	const http = createHttp({
		...config,
		auth,
		db,
		dataDir,
		localSession,
		hostPolicy,
		trustedOrigins,
		deviceKeyOf: (headers) => devices.host.keyOf(headers),
		devices: devices.devices,
		exchange: devices.hostExchange,
		offers: devices.offers,
		engine,
		settings,
		notifications,
		toolLaunchers,
		configUse: setups.configUse,
		assistant: assistant.withCosts(),
		checks: setups.checks,
		agentSetup: setups.agentSetup,
		deciderSetup: setups.deciderSetup,
		usage: telemetry,
		knowledge,
		ollama,
		projectSetup,
		daemon: {
			dataDir: info.dataDir,
			device: info.device,
			lease: info.lease,
		},
		corsOrigin: env.CORS_ORIGIN,
		leaseOwner: lease.owner,
		logRequests: dev,
		sync,
		// How Bun serves this daemon: the hostname of its reach, and its own
		// TLS when it has a certificate (NIGHTSHIFT_TLS_CERT, NIGHTSHIFT_TLS_KEY).
		serve: devices.serve,
	});

	return {
		...http,
		info,
		ownerHasLogin: owner.ownerHasLogin,
		stop,
		onLeaseHeartbeat: (listener) => lease.onHeartbeat(listener),
	};
}
