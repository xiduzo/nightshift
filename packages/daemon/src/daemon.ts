import { join } from "node:path";
import {
	cliHelp,
	startPriceUpdates,
	tanstackDecider,
} from "@nightshift/agents";
import type { Context } from "@nightshift/api/context";
import {
	createAuth,
	createLocalSession,
	documentAccess,
	hasLogin,
	hostPolicyFromEnv,
	localPerson,
	roleAllows,
	spaceIds,
} from "@nightshift/auth";
import { createDb } from "@nightshift/db";
import {
	databaseUrl,
	ensureDataDir,
	legacyData,
	resolveDataDir,
} from "@nightshift/db/data-dir";
import { migrateDb } from "@nightshift/db/migrate";
import {
	createPeerEngine,
	createRelay,
	createWorkHub,
	createWorkRelay,
	type DeviceServices,
	deviceDirectory,
	deviceOffers,
	listenHostname,
	ownCertificate,
	reachFor,
	selfDevice,
	selfOwnerId,
	setSelfOwner,
	wireDevices,
} from "@nightshift/devices";
import {
	checkProjectFolder,
	clonePathOf,
	createCliToolStore,
	createConnectionStore,
	createProfileStore,
	createSettingsStore,
	createSpaceDocuments,
	documentRows,
	localDevice,
	memberRole,
	openDeviceDocument,
	secretStore,
	setUpGit,
	spaceIdOf,
	systemGitInstaller,
} from "@nightshift/engine";

import { localHarnesses, programChecks, reportDeviceFacts } from "./harnesses";
import {
	authOriginsOf,
	createHttp,
	type DaemonServe,
	isThisComputer,
	trustedOriginsOf,
} from "./http";
import {
	createKeepAwake,
	engineRunSource,
	systemSleepLock,
} from "./keep-awake";
import { type DesktopScreen, wireNotifications } from "./notifications";
import {
	boundedStop,
	chooseFolder,
	type DaemonEnv,
	daemonPort,
	guardProcess,
	holdLease,
	hot,
	secretFiles,
	secretsDir,
	stopOnSignals,
} from "./runtime";
import { createSync } from "./sync";

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
};

/** Facts about this daemon that change only on a restart. */
export type DaemonInfo = Context["daemon"] & {
	databaseUrl: string;
	/** The lease this daemon holds: the desktop watchdog tells another daemon's apart. */
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
	 * A clean stop: writes what the Device and Space documents still have
	 * pending, and gives the lease up, so the next daemon starts at once.
	 * Bounded at 2 s. Never throws.
	 */
	stop(): Promise<void>;
};

/**
 * The daemon's composition root: every service of one daemon, wired. It
 * holds the database lease, opens the documents, starts the engine and the
 * timers, and returns what Bun serves. It does not listen: `startDaemon`
 * does. One per process: `bun --hot` calls it again on each reload, and the
 * hot-reload registry (`runtime/hot.ts`) keeps what must have one owner.
 */
export async function createDaemon(
	env: DaemonEnv,
	options: DaemonOptions = {},
): Promise<Daemon> {
	// First: an error nothing caught must never stop the timers (the lease
	// heartbeat, the scheduler). `nightshift serve` also exits on one.
	guardProcess();
	const port = options.port ?? daemonPort();

	/** The database, the transcripts and the command logs, together. */
	const dev = env.NIGHTSHIFT_DEV === "true";
	const dataDir = ensureDataDir(
		resolveDataDir({
			NIGHTSHIFT_DATA_DIR: env.NIGHTSHIFT_DATA_DIR,
			NIGHTSHIFT_DEV: dev,
		}),
	);

	// Run history from before the data directory is never moved for you.
	const legacy = legacyData({
		dataDir,
		databaseUrlSet: Boolean(env.DATABASE_URL?.trim()),
	});
	const legacyPaths = [legacy.database, ...legacy.files].filter(Boolean);
	if (legacyPaths.length > 0) {
		console.warn(
			`Earlier run history is in ${legacyPaths.join(", ")}. This daemon keeps its data in ${dataDir}. To copy it there, stop the daemon and run \`bun run data:migrate${dev ? " --dev" : ""}\`.`,
		);
	}

	const url = databaseUrl(env, dataDir);
	const db = createDb({ DATABASE_URL: url });
	await migrateDb(db, { migrationsFolder: options.migrationsFolder });

	const lease = await holdLease(db);
	const stop = () =>
		boundedStop(() =>
			Promise.all([
				hot.nightshiftDocument?.flush(),
				hot.nightshiftSpaces?.flush(),
				hot.nightshiftNotifications?.stop(),
				hot.nightshiftKeepAwake?.stop(),
				lease.release(),
			]),
		);
	stopOnSignals(stop);

	/**
	 * The Space documents: each Space's Projects, Clones (existence only) and
	 * Members. The engine defines Projects in them, the relay serves them to
	 * Members, and the auth hooks keep their Members in step.
	 */
	hot.nightshiftSpaces ??= createSpaceDocuments({
		db,
		directory: deviceDirectory(db),
	});
	const spaces = hot.nightshiftSpaces;

	const trustedOrigins = trustedOriginsOf(env, port);
	/** The Host's addresses, once the settings below exist. */
	let hostAddresses: () => readonly string[] = () => [];
	const auth = createAuth(env, db, authOriginsOf(port), {
		onMembersChanged: (spaceId) => spaces.mirrorMembers(spaceId),
		// The audit of Members, in the Space's event log. Called on requests,
		// long after the engine below is made.
		onMemberChange: (change) => engine.logMemberChange(change),
		// A browser may sign in at any of the Host's addresses. Read per
		// request; Better Auth also asks once now, before the settings exist.
		trustedOrigins: () => hostOrigins(hostAddresses()),
	});

	/**
	 * The Host's rules for sessions from other computers: two-factor sign-in
	 * required or not (NIGHTSHIFT_REQUIRE_TWO_FACTOR). Read at start.
	 */
	const hostPolicy = hostPolicyFromEnv(env);

	/** This computer's Device: the Walker of its runs, the owner of its Clones. */
	const device = await selfDevice(db);

	/**
	 * This Device's document: its profiles, CLI tools, connections, settings
	 * and facts. The stores below are views of it; the relay (`/sync`) serves
	 * it to this computer's clients, and their edits land in the same stores.
	 */
	hot.nightshiftDocument ??= await openDeviceDocument({
		db,
		deviceId: device.id,
	});
	const document = hot.nightshiftDocument;

	/** The Person who owns this computer, and their personal Space. */
	const person = await localPerson(db, {
		ownerId: await selfOwnerId(db),
		setOwner: (personId) => setSelfOwner(db, personId),
	});

	// Every Space's document, before the relay serves them: the Projects of a
	// Replica from before them are imported here, once.
	await spaces.openAll();

	/**
	 * One person on one computer signs in to nothing: a request from this
	 * computer without a session gets the session of the Person who owns it.
	 */
	const localSession = createLocalSession(auth, db, person.userId);

	/**
	 * The environment is the fallback of every setting and every `${NAME}`.
	 * Under it, the secret files a service manager gives a headless computer
	 * (NIGHTSHIFT_SECRETS_DIR, else systemd's credentials).
	 */
	const fallbacks: Record<string, string | undefined> = {
		...secretFiles(secretsDir()),
		...process.env,
		...env,
	};
	/** Secrets saved on the Connections page: the keychain, else a file per secret (headless). */
	const keyStore =
		env.NIGHTSHIFT_KEY_STORE === "file" ? { prefer: "file" as const } : {};

	const settings = createSettingsStore({ document, env: fallbacks });
	hostAddresses = () => settings.current().hostAddresses;
	const connections = createConnectionStore({
		document,
		env: fallbacks,
		secrets: await secretStore({ dataDir, ...keyStore }),
	});
	const cliTools = createCliToolStore({ document });
	const profiles = createProfileStore({ document });
	await Promise.all([
		settings.load(),
		connections.load(),
		cliTools.load(),
		profiles.load(),
	]);

	reportDeviceFacts({ db, document, deviceId: device.id, settings, kept: hot });

	/** Set once the engine runs: the Host's half of the devices. */
	let devices: DeviceServices;

	/**
	 * The relay's document half: the owner's clients sync this Device's
	 * document here. Kept across `bun --hot` reloads, like the document.
	 */
	hot.nightshiftSync ??= createSync({
		document: (name) =>
			name === document.name
				? document.doc
				: (spaces.byName(name)?.doc ?? null),
		// On a Host: the documents of the Devices whose home Host this is.
		kept: {
			has: async (name) =>
				(await engine.devices.keptDocumentOwner(name)) !== null,
			...documentRows(db),
		},
		authorize: documentAccess({
			auth,
			db,
			localSession,
			ownerId: person.userId,
			isThisComputer: (peer, request) =>
				isThisComputer(peer, request, trustedOrigins),
			spaceIdOf,
			policy: hostPolicy,
			keptOwner: (name) => engine.devices.keptDocumentOwner(name),
			deviceKey: (token) => devices.host.syncKey(token),
		}),
	});
	const sync = hot.nightshiftSync;

	// Only the newest engine may start scheduled runs: the one before stops
	// its scheduler.
	hot.nightshiftScheduler?.abort();
	const scheduler = new AbortController();
	hot.nightshiftScheduler = scheduler;

	/** This computer as a Device: every computer-touching piece of a step. */
	const local = localDevice({
		id: device.id,
		name: device.name,
		...localHarnesses({ settings, connections, piAcp: options.piAcp }),
		// Decision nodes decided by a model: TanStack AI deciders, with API keys from the secrets.
		decider: tanstackDecider({ secret: (name) => connections.secret(name) }),
		mcpServersFor: (node) => connections.mcpServersFor(node),
		// A Command node's secrets: the keychain, then the environment.
		secretEnv: (names) => connections.secretEnv(names),
		connectionNames: () => connections.names(),
		cliNames: () => cliTools.names(),
		findCli: (name) => Bun.which(name),
		cliToolsFor: (names) =>
			Promise.all(
				names.map(async (name) => ({
					name,
					description: cliTools.get(name)?.description ?? null,
					help: await cliHelp(name),
				})),
			),
		// The project's folder here: where its runs' worktrees branch from.
		clonePath: clonePathOf(db, async () => device.id),
		// Its profiles, for a run placed here from another Device.
		profileFor: (name) => profiles.settingsFor(name),
	});

	/**
	 * On a Host: the calls of the runs it walks, for the Devices they are
	 * placed on, which take them over their own links. Kept across `bun --hot`
	 * reloads, so a Device's stream outlives a reload.
	 */
	hot.nightshiftWork ??= createWorkHub({
		// A Device is back: the steps that slept while it was away look again.
		onBack: (deviceId) => {
			engine.deviceBack(deviceId).catch((error) => {
				console.error("Steps that waited for a device were not woken:", error);
			});
		},
	});
	const workHub = hot.nightshiftWork;
	/** The hub for the Spaces this computer keeps; its Hosts for the others. */
	const work = createWorkRelay({
		hub: workHub,
		engine: () => engine,
		links: () => devices.deviceLinks,
	});

	/**
	 * The price list that prices tokens when a harness reports no cost: the
	 * bundled one, then a newer one fetched once a day into the data folder.
	 * Not awaited: the daemon starts on the bundled list, never on the network.
	 */
	void startPriceUpdates({
		file: join(dataDir, "prices.json"),
		onError: (error) => console.warn("The price list was not updated:", error),
	});

	/**
	 * The actions on rows another Device owns (a Gate of a run walked
	 * elsewhere, a Clone in a Space a Host keeps), carried over the links.
	 * Lazy: the engine and the links are made below.
	 */
	const relayToHosts = createRelay({
		engine: () => engine,
		registry: () => engine.devices,
		links: () => devices.deviceLinks,
	});

	// The engine before a `bun --hot` reload lets go of its runs first: else
	// its drives, harnesses and step timers run on beside the runs this
	// engine's recovery continues, and end steps that are no longer theirs.
	await hot.nightshiftEngine?.dispose().catch((error) => {
		console.error(
			"The engine before the reload did not let go of its runs:",
			error,
		);
	});

	const engine = createPeerEngine({
		db,
		walkerId: device.id,
		device: local,
		work,
		relay: relayToHosts,
		dataDir,
		settings: () => settings.run(),
		profileFor: (name) => profiles.settingsFor(name),
		// This computer's own Offers, and who may use Offers in a Space.
		ownOffers: () => deviceOffers(document),
		mayUseOffers: async (spaceId, personId) => {
			const role = memberRole(await spaces.open(spaceId), personId);
			return role !== null && roleAllows(role, { offer: ["use"] });
		},
		spaceDocuments: spaces,
		// NIGHTSHIFT_SCHEDULER=off: no scheduler at all, whatever Settings says.
		// Otherwise the Settings switch is read on every tick.
		scheduler:
			env.NIGHTSHIFT_SCHEDULER === "off" ? false : { signal: scheduler.signal },
	});
	hot.nightshiftEngine = engine;

	/*
	 * Secure by default: this daemon answers this computer only, until it is
	 * a Host with an https:// address (read at start: a change applies on
	 * the next start). It serves https:// itself when it has a certificate
	 * (NIGHTSHIFT_TLS_CERT, NIGHTSHIFT_TLS_KEY).
	 */
	const reach = reachFor(settings.current());
	const certificate = ownCertificate(env);

	devices = await wireDevices({
		auth,
		db,
		engine,
		settings,
		profiles,
		document,
		spaces,
		self: device,
		ownerId: person.userId,
		local,
		workHub,
		dataDir,
		keyStore,
		reach,
		fingerprint: certificate?.fingerprint ?? null,
		devicesPage: new URL("/devices", env.CORS_ORIGIN).toString(),
		disconnect: (deviceId) =>
			sync.disconnect((context) => context.deviceId === deviceId),
		kept: hot,
	});

	const { notifications, settings: computerSettings } = await wireNotifications(
		{
			db,
			env,
			engine,
			settings,
			device,
			owner: person,
			desktop: options.desktop,
		},
	);

	/**
	 * "Keep this computer awake" (this computer's
	 * setting): the OS's sleep lock while a run here needs it.
	 */
	hot.nightshiftKeepAwake?.stop();
	const keepAwake = createKeepAwake({
		enabled: () => settings.current().keepAwake,
		runs: engineRunSource(engine, () => spaceIds(db)),
		lock: systemSleepLock(),
	});
	hot.nightshiftKeepAwake = keepAwake;
	// Not awaited: it reads the runs that have not ended.
	void keepAwake.start();

	const gitInstaller = systemGitInstaller();
	const info: DaemonInfo = {
		dataDir,
		device: { ...device, ownerId: person.userId },
		lease: {
			host: lease.host,
			pid: lease.pid,
			epoch: lease.epoch,
			since: lease.since.getTime(),
		},
		databaseUrl: url,
		leaseOwner: lease.owner,
		reach,
	};

	const http = createHttp({
		auth,
		db,
		localSession,
		hostPolicy,
		trustedOrigins,
		deviceKeyOf: (headers) => devices.host.keyOf(headers),
		devices: devices.devices,
		exchange: devices.hostExchange,
		offers: devices.offers,
		engine,
		settings: computerSettings,
		notifications,
		connections,
		cliTools,
		profiles,
		checks: programChecks(),
		projectSetup: {
			check: (path) => checkProjectFolder(path),
			setUpGit: (input) => setUpGit(input),
			installGit: () => gitInstaller.install(),
			chooseFolder: (prompt) => chooseFolder(prompt),
		},
		daemon: {
			dataDir: info.dataDir,
			device: info.device,
			lease: info.lease,
		},
		corsOrigin: env.CORS_ORIGIN,
		leaseOwner: lease.owner,
		sync,
		// How Bun serves this daemon: the hostname of its reach, and its own TLS.
		serve: {
			hostname: listenHostname(reach, env.NIGHTSHIFT_LISTEN),
			...(certificate
				? { tls: { cert: certificate.cert, key: certificate.key } }
				: {}),
		},
	});

	return {
		...http,
		info,
		ownerHasLogin: () => hasLogin(db, person.userId),
		stop,
	};
}

/** The origins of a Host's addresses (`https://name:port`). */
function hostOrigins(addresses: readonly string[]): string[] {
	return addresses.flatMap((address) => {
		try {
			return [new URL(address).origin];
		} catch {
			return [];
		}
	});
}
