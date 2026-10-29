import { join } from "node:path";
import { startPriceUpdates, tanstackDecider } from "@nightshift/agents";
import type { Context } from "@nightshift/api/context";
import {
	createAuth,
	createLocalSession,
	documentAccess,
	hasLogin,
	hostPolicyFromEnv,
	localPerson,
	spaceIds,
} from "@nightshift/auth";
import {
	databaseUrl,
	ensureDataDir,
	legacyData,
	resolveDataDir,
} from "@nightshift/db/data-dir";
import { migrateDb } from "@nightshift/db/migrate";
import {
	deviceDirectory,
	selfDevice,
	selfOwnerId,
	setSelfOwner,
	startDevices,
} from "@nightshift/devices";
import {
	createArtifactStore,
	createFlowDocuments,
	createToolLaunchers,
	documentSpace,
	localDevice,
} from "@nightshift/engine";
import {
	documentRows,
	openConfigStores,
	openDeviceDocument,
	secretStore,
} from "@nightshift/engine/device-config";
import {
	checkProjectFolder,
	clonePathOf,
	createGitHubClones,
	createProjectCopies,
	createSpaceDocuments,
	setUpGit,
	systemGitInstaller,
} from "@nightshift/engine/projects";
import { deliveryMoves } from "@nightshift/notifications";

import { createAssistant } from "./assistant";
import {
	harnessLookup,
	localHarnesses,
	programChecks,
	reportDeviceFacts,
} from "./harnesses";
import {
	authOriginsOf,
	createHttp,
	type DaemonServe,
	hostAuthOrigins,
	isThisComputer,
	trustedOriginsOf,
} from "./http";
import {
	createKeepAwake,
	engineRunSource,
	type SleepLock,
	systemSleepLock,
} from "./keep-awake";
import {
	type DesktopScreen,
	sendsPushesFor,
	wireNotifications,
} from "./notifications";
import {
	boundedStop,
	canChooseFolder,
	chooseFolder,
	type DaemonEnv,
	daemonPort,
	guardProcess,
	holdLease,
	hot,
	hotSlots,
	processDatabase,
	secretFiles,
	secretsDir,
	stopOnSignals,
} from "./runtime";
import { keepSync } from "./sync";

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
	 * A clean stop: stops the work of this daemon, writes what the Device,
	 * Space and flow documents still have pending, and gives the lease up,
	 * so the next daemon starts at once. Bounded at 2 s. Never throws.
	 */
	stop(): Promise<void>;
};

/**
 * The daemon's composition root: every service of one daemon, wired. It
 * holds the database lease, opens the documents, starts the devices with
 * the engine (`startDevices`) and the timers, and returns what Bun
 * serves. It does not listen: `startDaemon` does. One per process: `bun
 * --hot` calls it again on each reload, and each piece that must have one
 * owner names its slot and lifecycle here (`hotSlots`, `runtime/hot.ts`).
 */
export async function createDaemon(
	env: DaemonEnv,
	options: DaemonOptions = {},
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
	// One client per process: a `bun --hot` reload takes the one it has.
	const db = processDatabase(url);
	await migrateDb(db, { migrationsFolder: options.migrationsFolder });

	const slots = hotSlots(hot);
	const stop = () => boundedStop(() => slots.stop());
	stopOnSignals(stop);
	const lease = await slots.keep(
		"nightshiftLease",
		() => holdLease(db),
		(held) => held.release(),
	);

	/**
	 * The Space documents: each Space's Projects, Clones (existence only) and
	 * Members. The engine defines Projects in them, the relay serves them to
	 * Members, and the auth hooks keep their Members in step.
	 */
	const spaces = await slots.keep(
		"nightshiftSpaces",
		() => createSpaceDocuments({ db, directory: deviceDirectory(db) }),
		(kept) => kept.flush(),
	);

	/**
	 * The flow documents: each Project's flows and schedules, and their
	 * revisions (ADR 2). Every Device keeps a copy, and the relay serves
	 * them to the Devices of the Space.
	 */
	const flows = await slots.keep(
		"nightshiftFlows",
		() => createFlowDocuments({ db }),
		(kept) => kept.flush(),
	);

	const trustedOrigins = trustedOriginsOf(env, port);
	/** Whether this computer is a Host, and its addresses, once the settings below exist. */
	let hostSettings: () => { host: boolean; hostAddresses: readonly string[] } =
		() => ({ host: false, hostAddresses: [] });
	const auth = createAuth(env, db, authOriginsOf(port), {
		onMembersChanged: (spaceId) => spaces.mirrorMembers(spaceId),
		// The audit of Members, in the Space's event log. Called on requests,
		// long after the engine below is made.
		onMemberChange: (change) => engine.logMemberChange(change),
		// A browser may sign in at any of the Host's addresses, the phone app
		// only at a Host. Read per request; Better Auth also asks once now,
		// before the settings exist.
		trustedOrigins: () => hostAuthOrigins(hostSettings()),
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
	const document = await slots.keep(
		"nightshiftDocument",
		() => openDeviceDocument({ db, deviceId: device.id }),
		(kept) => kept.flush(),
	);

	/** The Person who owns this computer, and their personal Space. */
	const person = await localPerson(db, {
		ownerId: await selfOwnerId(db),
		setOwner: (personId) => setSelfOwner(db, personId),
	});

	// Every Space's document, before the relay serves them: the Projects of a
	// Replica from before them are imported here, once.
	await spaces.openAll();
	await flows.openAll();

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

	const config = await openConfigStores({
		document,
		env: fallbacks,
		secrets: await secretStore({ dataDir, ...keyStore }),
	});
	const { settings, connections, cliTools, profiles } = config;
	hostSettings = () => settings.current();
	// Each CLI tool with a login runs through a launcher of its step. A
	// login's own folder is in the data folder, so it outlives a restart.
	const toolLaunchers = createToolLaunchers({
		tools: cliTools,
		secretEnv: (names) => connections.secretEnv(names),
		dataDir,
		env: { ...process.env, ...env },
	});

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

	const harnesses = localHarnesses({
		settings,
		connections,
		piAcp: options.piAcp,
	});
	/** The project's folder here: where its runs' worktrees branch from. */
	const clonePath = clonePathOf(db, async () => device.id);

	/** This computer as a Device: every computer-touching piece of a step. */
	const local = localDevice({
		id: device.id,
		name: device.name,
		...harnesses,
		// Decision nodes decided by a model: TanStack AI deciders, with API keys from the secrets.
		decider: tanstackDecider({ secret: (name) => connections.secret(name) }),
		mcpServersFor: (node) => connections.mcpServersFor(node),
		// A Command node's secrets: the keychain, then the environment.
		secretEnv: (names) => connections.secretEnv(names),
		connectionNames: () => connections.names(),
		cliNames: () => cliTools.names(),
		findCli: (name) => Bun.which(cliTools.program(name)),
		cliToolsFor: (names) => cliTools.guides(names),
		toolLaunchers,
		clonePath,
		// The flows another Device's older Walker asks this one for: the
		// engine's (made below, before anyone can ask), a flow of format 6
		// as the Device that saved it named its profiles.
		flows: (projectId) => devices.engine.flows.flows(projectId),
		// Its profiles, for a run placed here from another Device.
		profileFor: (ref) => profiles.settingsFor(ref),
		// The files agents keep for the person, next to the run history.
		artifacts: createArtifactStore(dataDir),
	});

	/**
	 * The price list that prices tokens when a harness reports no cost: the
	 * bundled one, then a newer one fetched once a day into the data folder.
	 * Not awaited: the daemon starts on the bundled list, never on the network.
	 */
	void slots
		.replace(
			"nightshiftPrices",
			() =>
				startPriceUpdates({
					file: join(dataDir, "prices.json"),
					...(outside.fetch ? { fetch: outside.fetch } : {}),
					onError: (error) =>
						console.warn("The price list was not updated:", error),
				}),
			(before) => before.stop(),
		)
		.catch((error) => console.warn("The price list was not updated:", error));

	/**
	 * This computer among Devices: the engine with its peers, the Host it
	 * may be, its Offers and its Links to its Hosts. Secure by default: it
	 * answers this computer only until it is a Host with an https://
	 * address (read at start). On a `bun --hot` reload the runtime before
	 * hands over to this one: its engine lets go of its runs first, and the
	 * work of placed steps goes on.
	 */
	slots.handOver("nightshiftDevices", (handover) => handover.release());
	const devices = await startDevices({
		auth,
		db,
		env,
		settings,
		profiles,
		document,
		spaces,
		flows,
		self: device,
		ownerId: person.userId,
		local,
		dataDir,
		keyStore,
		// NIGHTSHIFT_SCHEDULER=off: no scheduler at all, whatever Settings says.
		// Otherwise the Settings switch is read on every tick.
		scheduler:
			env.NIGHTSHIFT_SCHEDULER === "off" ? false : { signal: scheduler.signal },
		// The secret a webhook schedule names: the keychain, then the environment.
		secret: (name) => connections.secret(name),
		// The relay below is made once per process, before any access is removed.
		disconnect: (deviceId) =>
			hot.nightshiftSync?.disconnect(
				(context) => context.deviceId === deviceId,
			),
		// A Space move takes the notifier's log of the moved runs along.
		// Their new Space's sender notifies for them from then on.
		moveRows: [deliveryMoves(db, sendsPushesFor(db, settings, person))],
		kept: hot,
	});
	const { engine } = devices;

	/**
	 * The relay's document half: the owner's clients sync this Device's
	 * document here. Kept across `bun --hot` reloads with its connections,
	 * like the document, and bound to this daemon's closures.
	 */
	const sync = await keepSync(slots, {
		document: async (name) =>
			name === document.name
				? document.doc
				: (spaces.byName(name)?.doc ?? (await flows.find(name))?.doc ?? null),
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
			spaceOfDocument: documentSpace(db),
			policy: hostPolicy,
			keptOwner: (name) => engine.devices.keptDocumentOwner(name),
			deviceKey: (token) => devices.host.syncKey(token),
		}),
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
			slots,
		},
	);

	/**
	 * "Keep this computer awake" (this computer's
	 * setting): the OS's sleep lock while a run here needs it.
	 */
	const keepAwake = await slots.replace(
		"nightshiftKeepAwake",
		() =>
			createKeepAwake({
				enabled: () => settings.current().keepAwake,
				runs: engineRunSource(engine, () => spaceIds(db)),
				lock:
					outside.sleepLock !== undefined
						? outside.sleepLock
						: systemSleepLock(),
			}),
		(before) => before.stop(),
	);
	// Not awaited: it reads the runs that have not ended.
	void keepAwake.start();

	const gitInstaller = systemGitInstaller();
	// A clone from GitHub outlives a `bun --hot` reload: keep who tracks it.
	const gitHubClones = await slots.keep("nightshiftGitHubClones", () =>
		createGitHubClones({ dataDir }),
	);
	/**
	 * "Copy every project": a Host copies each project of its Spaces it has
	 * no Clone of. New on each reload, so it adds Clones through this
	 * engine. A clone it started goes on in `gitHubClones`.
	 */
	const projectCopies = await slots.replace(
		"nightshiftProjectCopies",
		() =>
			createProjectCopies({
				gitHub: gitHubClones,
				spaceIds: () => spaceIds(db),
				space: (spaceId) => engine.space(spaceId),
				enabled: () => {
					const current = settings.current();
					return current.host && current.copyProjects;
				},
			}),
		(before) => before.stop(),
	);
	projectCopies.start();

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
		reach: devices.reach,
	};

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
		settings: computerSettings,
		notifications,
		toolLaunchers,
		// Suggestions and chats in the flow editor: on this computer's
		// profiles, read only in the project's Clone. A chat reads the
		// project's flows and runs as the Person sees them in the Space.
		assistant: createAssistant({
			profiles,
			settings,
			...harnessLookup(harnesses, settings),
			clonePath,
			space: ({ spaceId, personId }) => engine.space(spaceId, { personId }),
			cliTools,
			connections,
		}),
		checks: programChecks(),
		projectSetup: {
			check: (path) => checkProjectFolder(path),
			setUpGit: (input) => setUpGit(input),
			installGit: () => gitInstaller.install(),
			chooseFolder: (prompt) => chooseFolder(prompt),
			folderPicker: canChooseFolder(),
			gitHub: gitHubClones,
			copies: projectCopies,
		},
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
		ownerHasLogin: () => hasLogin(db, person.userId),
		stop,
	};
}
