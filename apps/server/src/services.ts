import {
	type AgentHarness,
	acpHarness,
	checkCli,
	checkHarness,
	claudeCodeHarness,
	cliHelp,
	codexHarness,
	grokBuildHarness,
	harnessFacts,
	harnessModels,
	opencodeHarness,
	pathPrograms,
	tanstackDecider,
	testMcpServer,
} from "@nightshift/agents";
import type { Context } from "@nightshift/api/context";
import { createAuth } from "@nightshift/auth";
import { createLocalSession } from "@nightshift/auth/local-session";
import { localPerson } from "@nightshift/auth/spaces";
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
	createCliToolStore,
	createConnectionStore,
	createEngine,
	createProfileStore,
	createSettingsStore,
	type DeviceDocument,
	HARNESS_BIN,
	keychainSecrets,
	LEASE_HEARTBEAT_MS,
	type Lease,
	LeaseHeldError,
	localDevice,
	openDeviceDocument,
	refreshDeviceFacts,
	selfDevice,
	setUpGit,
	systemGitInstaller,
} from "@nightshift/engine";

import { desktopOrigins, ENV, trustedOrigins } from "./env.server";
import { createSync, ownerOnly, type Sync } from "./sync";

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
await migrateDb(db);

/** This Device's document, once it is open (below). Kept across `bun --hot` reloads. */
const opened = globalThis as { nightshiftDocument?: DeviceDocument };

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
	// gives the lease up, so the next daemon starts at once.
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		process.once(signal, () => {
			const pending = opened.nightshiftDocument?.flush();
			void Promise.race([
				Promise.all([pending, lease.release()]),
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

export const auth = createAuth(ENV, db, desktopOrigins);

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

/**
 * One person on one computer signs in to nothing: a request from this
 * computer without a session gets the session of the Person who owns it.
 */
export const localSession = createLocalSession(auth, db, person.userId);

/** The environment is the fallback of every setting and every `${NAME}`. */
const env: Record<string, string | undefined> = { ...process.env, ...ENV };

export const settings = createSettingsStore({ document, env });
export const connections = createConnectionStore({
	document,
	env,
	secrets: keychainSecrets(),
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
			return Object.fromEntries(
				s.harnesses.map((name) => [name, Bun.which(s[HARNESS_BIN[name]])]),
			);
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
	document: (name) => (name === document.name ? document.doc : null),
	authorize: ownerOnly({
		auth,
		db,
		localSession,
		ownerId: person.userId,
		trustedOrigins,
	}),
});
export const sync = relay.nightshiftSync;

/** A harness built per session, so a changed path in Settings applies to the next session. */
function perSession(
	name: AgentHarness["name"],
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
	},
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
});

export const engine = await createEngine({
	db,
	walkerId: device.id,
	device: local,
	dataDir,
	settings: () => settings.run(),
	profileFor: (name) => profiles.settingsFor(name),
	// NIGHTSHIFT_SCHEDULER=off: no scheduler at all, whatever Settings says.
	// Otherwise the Settings switch is read on every tick.
	scheduler:
		ENV.NIGHTSHIFT_SCHEDULER === "off" ? false : { signal: scheduler.signal },
});

export const checks: Context["checks"] = {
	harness: checkHarness,
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
