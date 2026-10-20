import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type AgentHarness,
	acpHarness,
	checkCli,
	checkCustomAgent,
	checkHarness,
	claudeCodeHarness,
	cliHelp,
	codexHarness,
	customAcpHarness,
	grokBuildHarness,
	type HarnessName,
	harnessFacts,
	harnessModels,
	opencodeHarness,
	pathPrograms,
	startPriceUpdates,
	tanstackDecider,
	testMcpServer,
} from "@nightshift/agents";
import type { Context } from "@nightshift/api/context";
import {
	createAuth,
	createLocalSession,
	hostPolicyFromEnv,
	localPerson,
	roleAllows,
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
	acquireLease,
	checkProjectFolder,
	clonePathOf,
	createCliToolStore,
	createConnectionStore,
	createEngine,
	createHostLinks,
	createOfferSlots,
	createProfileStore,
	createSettingsStore,
	createSpaceDocuments,
	type DeviceDocument,
	deviceKeyStore,
	deviceOffers,
	documentRows,
	type Engine,
	HARNESS_BIN,
	LEASE_HEARTBEAT_MS,
	type Lease,
	LeaseHeldError,
	localDevice,
	memberRole,
	openDeviceDocument,
	refreshDeviceFacts,
	type SpaceDocuments,
	secretStore,
	selfDevice,
	setUpGit,
	systemGitInstaller,
} from "@nightshift/engine";
import { secretFiles, secretsDir } from "./daemon-env";
import {
	createDeviceLinks,
	createDevices,
	createHost,
	type DeviceLinks,
	listenHostname,
	reachFor,
} from "./devices";
import { exchangeWithHost } from "./devices/exchange";
import { createHostExchange } from "./devices/host-exchange";
import { createOffers } from "./devices/offers";
import { createRelay } from "./devices/relay";
import { certificateFingerprint } from "./devices/tls";
import {
	createOfferCalls,
	createWorkServer,
	type OfferDeps,
	type WorkServer,
} from "./devices/work";
import { createWorkHub, type WorkHub } from "./devices/work-hub";
import { createWorkRelay } from "./devices/work-relay";
import {
	desktopOrigins,
	ENV,
	localOrigins,
	trustedOrigins,
} from "./env.server";
import { migrationsFolder } from "./headless/embedded";
import { guardProcess } from "./process-guard";
import { createSync, documentAccess, type Sync } from "./sync";

// First: an error nothing caught must never stop the timers (the lease
// heartbeat, the scheduler). `nightshift serve` also exits on one.
guardProcess();

/** The database, the transcripts and the command logs, together. */
const dev = ENV.NIGHTSHIFT_DEV === "true";
const dataDir = ensureDataDir(
	resolveDataDir({
		NIGHTSHIFT_DATA_DIR: ENV.NIGHTSHIFT_DATA_DIR,
		NIGHTSHIFT_DEV: dev,
	}),
);

// Run history from before the data directory is never moved for you.
const legacy = legacyData({
	dataDir,
	databaseUrlSet: Boolean(ENV.DATABASE_URL?.trim()),
});
const legacyPaths = [legacy.database, ...legacy.files].filter(Boolean);
if (legacyPaths.length > 0) {
	console.warn(
		`Earlier run history is in ${legacyPaths.join(", ")}. This daemon keeps its data in ${dataDir}. To copy it there, stop the daemon and run \`bun run data:migrate${dev ? " --dev" : ""}\`.`,
	);
}

export const db = createDb({ DATABASE_URL: databaseUrl(ENV, dataDir) });
// The `nightshift` binary carries its migrations: they are extracted first.
await migrateDb(db, { migrationsFolder: migrationsFolder() });

/**
 * This Device's document and the Space documents, once they are open
 * (below). Kept across `bun --hot` reloads, so each has one writer.
 */
const opened = globalThis as {
	nightshiftDocument?: DeviceDocument;
	nightshiftSpaces?: SpaceDocuments;
};

/**
 * One daemon per database: take the lease before the engine recovers
 * interrupted work or the scheduler starts. Another live daemon on this
 * database stops this one here. A daemon that loses the lease later (its
 * machine slept past the stale window and another daemon started) fences
 * itself: it exits with code 3 and writes nothing more.
 */
async function holdLease(): Promise<Lease> {
	let lease: Lease;
	try {
		lease = await acquireLease({
			db,
			onLost: (reason) => {
				console.error(
					`SELF-FENCE: ${reason} Another daemon holds this database now. Exiting without writing anything more.`,
				);
				process.exit(3);
			},
		});
	} catch (error) {
		if (!(error instanceof LeaseHeldError)) throw error;
		console.error(error.message);
		process.exit(1);
	}
	setInterval(() => {
		lease.heartbeat().catch((error) => {
			// A failed write is not a lost lease: the next heartbeat tries again.
			console.error("The lease heartbeat failed:", error);
		});
	}, LEASE_HEARTBEAT_MS).unref();
	// A clean stop writes what the Device document still has pending, and
	// gives the lease up, so the next daemon starts at once. The 2 s bound
	// is a timer, and dead timers never fire it. The writes need no timer,
	// so a stop still ends when they do. If one hangs too: a second signal
	// stops the process at once (`once`: the default action is back), and
	// every watchdog sends SIGKILL a few seconds after SIGTERM.
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		process.once(signal, () => {
			const pending = [
				opened.nightshiftDocument?.flush(),
				opened.nightshiftSpaces?.flush(),
			];
			void Promise.race([
				Promise.all([...pending, lease.release()]),
				Bun.sleep(2_000),
			])
				.catch(() => {})
				.finally(() => process.exit(0));
		});
	}
	console.log(
		`Holding the database lease: epoch ${lease.epoch}, pid ${lease.pid} on ${lease.host}.`,
	);
	return lease;
}

// `bun --hot` evaluates this module again on each reload, in the same
// process: keep the lease this process holds.
const held = globalThis as { nightshiftLease?: Lease };
held.nightshiftLease ??= await holdLease();
export const lease = held.nightshiftLease;

/**
 * The Space documents: each Space's Projects, Clones (existence only) and
 * Members. The engine defines Projects in them, the relay serves them to
 * Members, and the auth hooks keep their Members in step.
 */
opened.nightshiftSpaces ??= createSpaceDocuments({ db });
export const spaces = opened.nightshiftSpaces;

export const auth = createAuth(ENV, db, [...desktopOrigins, ...localOrigins], {
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
export const hostPolicy = hostPolicyFromEnv(ENV);

/** The Host's addresses, once the settings below exist. */
let hostAddresses: () => readonly string[] = () => [];

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

/** This computer's Device: the Walker of its runs, the owner of its Clones. */
export const device = await selfDevice(db);

/**
 * This Device's document: its profiles, CLI tools, connections, settings
 * and facts. The stores below are views of it; the relay (`/sync`) serves
 * it to this computer's clients, and their edits land in the same stores.
 * `bun --hot` evaluates this module again on each reload: the document
 * this process opened stays, so it has one writer.
 */
opened.nightshiftDocument ??= await openDeviceDocument({
	db,
	deviceId: device.id,
});
export const document = opened.nightshiftDocument;

/** The Person who owns this computer, and their personal Space. */
const person = await localPerson(db);

// Every Space's document, before the relay serves them: the Projects of a
// Replica from before them are imported here, once.
await spaces.openAll();

/**
 * One person on one computer signs in to nothing: a request from this
 * computer without a session gets the session of the Person who owns it.
 */
export const localSession = createLocalSession(auth, db, person.userId);

/**
 * The environment is the fallback of every setting and every `${NAME}`.
 * Under it, the secret files a service manager gives a headless computer
 * (NIGHTSHIFT_SECRETS_DIR, else systemd's credentials).
 */
const env: Record<string, string | undefined> = {
	...secretFiles(secretsDir()),
	...process.env,
	...ENV,
};
/** Secrets saved on the Connections page: the keychain, else a file per secret (headless). */
const keyStorePreference =
	ENV.NIGHTSHIFT_KEY_STORE === "file" ? { prefer: "file" as const } : {};

export const settings = createSettingsStore({ document, env });
hostAddresses = () => settings.current().hostAddresses;
export const connections = createConnectionStore({
	document,
	env,
	secrets: await secretStore({ dataDir, ...keyStorePreference }),
});
export const cliTools = createCliToolStore({ document });
export const profiles = createProfileStore({ document });
await Promise.all([
	settings.load(),
	connections.load(),
	cliTools.load(),
	profiles.load(),
]);

/**
 * The facts this computer reports in its document: written at start and
 * every ten minutes after, in the background (listing the programs reads
 * every PATH directory).
 */
function refreshFacts(): void {
	refreshDeviceFacts({
		db,
		document,
		deviceId: device.id,
		harnesses: () => {
			const s = settings.current();
			return Object.fromEntries([
				...s.harnesses.map((name) => [name, Bun.which(s[HARNESS_BIN[name]])]),
				...s.customAgents.map((a) => [
					`acp:${a.slug}` as const,
					Bun.which(a.command),
				]),
			]);
		},
		programs: () => pathPrograms(),
	}).catch((error) => {
		console.error("This computer's facts were not updated:", error);
	});
}
const facts = globalThis as { nightshiftFacts?: Timer };
if (facts.nightshiftFacts) clearInterval(facts.nightshiftFacts);
refreshFacts();
facts.nightshiftFacts = setInterval(refreshFacts, 10 * 60_000);
facts.nightshiftFacts.unref();

/**
 * The relay's document half: the owner's clients sync this Device's
 * document here. Kept across `bun --hot` reloads, like the document.
 */
const relay = globalThis as { nightshiftSync?: Sync };
relay.nightshiftSync ??= createSync({
	document: (name) =>
		name === document.name ? document.doc : (spaces.byName(name)?.doc ?? null),
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
		trustedOrigins,
		policy: hostPolicy,
		keptOwner: (name) => engine.devices.keptDocumentOwner(name),
		deviceKey: (token) => host.syncKey(token),
	}),
});
export const sync = relay.nightshiftSync;

/** A harness built per session, so a changed path in Settings applies to the next session. */
function perSession(
	name: HarnessName,
	build: () => AgentHarness,
): AgentHarness {
	return { name, ...harnessFacts(name), run: (input) => build().run(input) };
}

// `bun --hot` evaluates this module again on each reload. Only the newest
// engine may start scheduled runs: the one before stops its scheduler.
const hot = globalThis as { nightshiftScheduler?: AbortController };
hot.nightshiftScheduler?.abort();
const scheduler = new AbortController();
hot.nightshiftScheduler = scheduler;

/** This computer as a Device: every computer-touching piece of a step. */
const local = localDevice({
	id: device.id,
	name: device.name,
	harnesses: {
		// Each harness spawns its CLI only when an Agent node names it.
		"claude-code": perSession("claude-code", () =>
			claudeCodeHarness({
				claudeExecutable: settings.current().claudeBin,
			}),
		),
		opencode: perSession("opencode", () =>
			opencodeHarness({
				opencodeExecutable: settings.current().opencodeBin,
			}),
		),
		codex: perSession("codex", () =>
			codexHarness({
				codexExecutable: settings.current().codexBin,
			}),
		),
		"grok-build": perSession("grok-build", () =>
			grokBuildHarness({ grokExecutable: settings.current().grokBin }),
		),
		copilot: perSession("copilot", () =>
			acpHarness("copilot", { executable: settings.current().copilotBin }),
		),
		gemini: perSession("gemini", () =>
			acpHarness("gemini", { executable: settings.current().geminiBin }),
		),
		cursor: perSession("cursor", () =>
			acpHarness("cursor", { executable: settings.current().cursorBin }),
		),
		pi: perSession("pi", () =>
			acpHarness("pi", { executable: settings.current().piBin }),
		),
	},
	// Custom agents: read from the settings at each session, so an edit
	// applies to the next one. `${NAME}` in their env reads the secrets.
	customHarness: (name) => {
		const agent = settings
			.current()
			.customAgents.find((a) => `acp:${a.slug}` === name);
		if (!agent) return undefined;
		return customAcpHarness(agent, {
			env: async () => {
				const expanded = await connections.expandEnv(agent.env);
				if (expanded.ok) return expanded.env;
				const [noun, isNot, it] =
					expanded.missing.length === 1
						? ["secret", "it is", "it"]
						: ["secrets", "they are", "them"];
				throw new Error(
					`${agent.label} needs the ${noun} ${expanded.missing.join(", ")}, but ${isNot} not saved. Save ${it} under Agents → Secrets, or remove the reference.`,
				);
			},
		});
	},
	customHarnessNames: () =>
		settings.current().customAgents.map((a) => `acp:${a.slug}` as const),
	harnessNames: () => new Set(settings.current().harnesses),
	// Decision nodes decided by a model: TanStack AI deciders, with API keys from the secrets.
	decider: tanstackDecider({ secret: (name) => connections.secret(name) }),
	mcpServersFor: (node) => connections.mcpServersFor(node),
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
	clonePath: clonePathOf(db),
	// Its profiles, for a run placed here from another Device.
	profileFor: (name) => profiles.settingsFor(name),
});

/**
 * On a Host: the calls of the runs it walks, for the Devices they are
 * placed on, which take them over their own links. Kept across `bun --hot`
 * reloads, so a Device's stream outlives a reload.
 */
const hotWork = globalThis as { nightshiftWork?: WorkHub };
hotWork.nightshiftWork ??= createWorkHub({
	// A Device is back: the steps that slept while it was away look again.
	onBack: (deviceId) => {
		engine.deviceBack(deviceId).catch((error) => {
			console.error("Steps that waited for a device were not woken:", error);
		});
	},
});
const workHub = hotWork.nightshiftWork;
/** The hub for the Spaces this computer keeps; its Hosts for the others. */
const work = createWorkRelay({
	hub: workHub,
	engine: () => engine,
	links: () => deviceLinks,
});

/**
 * The actions on rows another Device owns (a Gate of a run walked
 * elsewhere, a Clone in a Space a Host keeps), carried over the links.
 * Lazy: the engine and the links are made below.
 */
/**
 * The price list that prices tokens when a harness reports no cost: the
 * bundled one, then a newer one fetched once a day into the data folder.
 */
// Not awaited: the daemon starts on the bundled list, never on the network.
void startPriceUpdates({
	file: join(dataDir, "prices.json"),
	onError: (error) => console.warn("The price list was not updated:", error),
});

const relayToHosts = createRelay({
	engine: () => engine,
	registry: () => engine.devices,
	links: () => deviceLinks,
});

// `bun --hot` evaluates this module again on each reload, in the same
// process. The engine before lets go of its runs first: else its drives,
// harnesses and step timers run on beside the runs this engine's recovery
// continues, and end steps that are no longer theirs.
const engines = globalThis as { nightshiftEngine?: Engine };
await engines.nightshiftEngine?.dispose().catch((error) => {
	console.error(
		"The engine before the reload did not let go of its runs:",
		error,
	);
});

export const engine = await createEngine({
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
		ENV.NIGHTSHIFT_SCHEDULER === "off" ? false : { signal: scheduler.signal },
});
engines.nightshiftEngine = engine;

/*
 * Devices. Secure by default: this daemon answers this computer only,
 * until it is a Host with an https:// address (read at start: a change
 * applies on the next start). It serves https:// itself when it has a
 * certificate (NIGHTSHIFT_TLS_CERT, NIGHTSHIFT_TLS_KEY).
 */
const reach = reachFor(settings.current());
const certificate =
	ENV.NIGHTSHIFT_TLS_CERT && ENV.NIGHTSHIFT_TLS_KEY
		? {
				cert: readFileSync(ENV.NIGHTSHIFT_TLS_CERT, "utf8"),
				key: readFileSync(ENV.NIGHTSHIFT_TLS_KEY, "utf8"),
			}
		: null;
const fingerprint = certificate
	? certificateFingerprint(certificate.cert)
	: null;
/** How Bun serves this daemon: the hostname of its reach, and its own TLS. */
export const serve = {
	hostname: listenHostname(reach, ENV.NIGHTSHIFT_LISTEN),
	...(certificate ? { tls: certificate } : {}),
};

/** This computer as a Host: pairing, Device keys, presence. */
export const host = createHost({
	auth,
	db,
	registry: engine.devices,
	settings,
	self: device,
	devicesPage: new URL("/devices", ENV.CORS_ORIGIN).toString(),
	fingerprint,
	disconnect: (deviceId) =>
		sync.disconnect((context) => context.deviceId === deviceId),
});

/**
 * This computer's Offers, for the steps of other Persons' runs it serves:
 * the sessions and calls running under each, for every Host and itself.
 */
const offerDeps: OfferDeps = {
	offers: () => deviceOffers(document),
	profileFor: (name) => profiles.settingsFor(name),
	slots: createOfferSlots(),
	calls: createOfferCalls(),
};

/** This computer as the Host of run history: what paired Devices pull, push and archive. */
export const hostExchange = createHostExchange({
	db,
	engine,
	registry: engine.devices,
	selfId: device.id,
	ownerId: person.userId,
	isHost: host.isHost,
	work: workHub,
	local,
	offerDeps,
});

/** A Device whose link says nothing for this long is offline. Its heartbeat comes every 15 s. */
const OFFLINE_AFTER_MS = 45_000;
const presence = globalThis as { nightshiftPresence?: Timer };
if (presence.nightshiftPresence) clearInterval(presence.nightshiftPresence);
presence.nightshiftPresence = setInterval(() => {
	engine.devices.sweep(OFFLINE_AFTER_MS).catch((error) => {
		console.error("Device presence was not updated:", error);
	});
	// The steps' own timers are the fast path; this ends a step they missed.
	engine.endOverdueSteps().catch((error) => {
		console.error("Steps past their time limits were not ended:", error);
	});
}, 5_000);
presence.nightshiftPresence.unref();

/** Per Host: this computer as the Device the Host's runs are placed on. */
const workServers = new Map<string, WorkServer>();
function workServer(hostId: string): WorkServer {
	let server = workServers.get(hostId);
	if (!server) {
		server = createWorkServer({
			hostId,
			db,
			engine,
			device: local,
			...offerDeps,
		});
		workServers.set(hostId, server);
	}
	return server;
}

/** This computer's Offers into Spaces, as its owner makes and withdraws them. */
export const offers = createOffers({
	db,
	engine,
	document,
	profiles,
	self: { id: device.id, name: device.name },
	ownerId: person.userId,
	withdrawn: (spaceId, profile) => offerDeps.calls.withdrawn(spaceId, profile),
});

/** This computer's links to the Hosts it paired with. Restarted on `bun --hot`. */
const hostLinks = createHostLinks(db);
const keyStore = await deviceKeyStore({ dataDir, ...keyStorePreference });
const linked = globalThis as { nightshiftLinks?: DeviceLinks };
await linked.nightshiftLinks?.close();
linked.nightshiftLinks = createDeviceLinks({
	links: hostLinks,
	keys: keyStore,
	document,
	// The Spaces the Host lists: kept here as the Host's, their documents
	// synced read-only, before run rows that name their projects arrive.
	spaceDocuments: async (link, hello) => {
		const { hostSpaces } = engine.exchange;
		await hostSpaces.update(
			{ id: link.hostId, name: hello.host.name },
			hello.spaces,
			person.userId,
		);
		const kept = new Set(await hostSpaces.ofHost(link.hostId));
		return Promise.all(
			hello.spaces
				.filter((space) => kept.has(space.id))
				.map(async (space) => {
					const opened = await spaces.open(space.id);
					return { name: opened.name, doc: opened.doc };
				}),
		);
	},
	// Run history both ways, the commands for the runs this computer walks,
	// and the steps of the Host's runs placed on this computer.
	whileOnline: (link, client, _hello, signal) =>
		Promise.all([
			exchangeWithHost({
				engine,
				hostId: link.hostId,
				client,
				selfId: device.id,
				signal,
			}),
			workServer(link.hostId).whileOnline(client, signal),
		]).then(() => {}),
});
await linked.nightshiftLinks.start();
export const deviceLinks = linked.nightshiftLinks;

export const devices = createDevices({
	host,
	links: deviceLinks,
	hostLinks,
	keys: keyStore,
	settings,
	self: { id: device.id, name: device.name, platform: process.platform },
	reach,
	fingerprint,
});

export const checks: Context["checks"] = {
	harness: checkHarness,
	customAgent: checkCustomAgent,
	cli: (name) => checkCli(name),
	programs: () => pathPrograms(),
	mcp: (config, redact) => testMcpServer(config, { redact }),
	models: harnessModels,
};

const gitInstaller = systemGitInstaller();
export const projectSetup: Context["projectSetup"] = {
	check: (path) => checkProjectFolder(path),
	setUpGit: (input) => setUpGit(input),
	installGit: () => gitInstaller.install(),
};

export const daemon: Context["daemon"] = {
	dataDir,
	device: { ...device, ownerId: person.userId },
	lease: {
		host: lease.host,
		pid: lease.pid,
		epoch: lease.epoch,
		since: lease.since.getTime(),
	},
};
