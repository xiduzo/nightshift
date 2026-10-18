import {
	type AgentHarness,
	acpHarness,
	checkCli,
	checkHarness,
	claudeCodeHarness,
	cliHelp,
	codexHarness,
	grokBuildHarness,
	harnessModels,
	opencodeHarness,
	pathPrograms,
	tanstackDecider,
	testMcpServer,
} from "@nightshift/agents";
import type { Context } from "@nightshift/api/context";
import { createAuth } from "@nightshift/auth";
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
	createCliToolStore,
	createConnectionStore,
	createEngine,
	createProfileStore,
	createSettingsStore,
	keychainSecrets,
	LEASE_HEARTBEAT_MS,
	type Lease,
	LeaseHeldError,
} from "@nightshift/engine";

import { desktopOrigins, ENV } from "./env.server";

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
	// A clean stop gives the lease up, so the next daemon starts at once.
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		process.once(signal, () => {
			void Promise.race([lease.release(), Bun.sleep(2_000)])
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

/** The environment is the fallback of every setting and every `${NAME}`. */
const env: Record<string, string | undefined> = { ...process.env, ...ENV };

export const settings = createSettingsStore({ db, env });
export const connections = createConnectionStore({
	db,
	env,
	secrets: keychainSecrets(),
});
export const cliTools = createCliToolStore({ db });
export const profiles = createProfileStore({ db });
await Promise.all([
	settings.load(),
	connections.load(),
	cliTools.load(),
	profiles.load(),
]);

/** A harness built per session, so a changed path in Settings applies to the next session. */
function perSession(
	name: AgentHarness["name"],
	build: () => AgentHarness,
): AgentHarness {
	return { name, run: (input) => build().run(input) };
}

// `bun --hot` evaluates this module again on each reload. Only the newest
// engine may start scheduled runs: the one before stops its scheduler.
const hot = globalThis as { nightshiftScheduler?: AbortController };
hot.nightshiftScheduler?.abort();
const scheduler = new AbortController();
hot.nightshiftScheduler = scheduler;

export const engine = await createEngine({
	db,
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
	// Decision nodes decided by a model: TanStack AI deciders, with API keys from the secrets.
	decider: tanstackDecider({ secret: (name) => connections.secret(name) }),
	dataDir,
	settings: () => settings.run(),
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
	harnessNames: () => new Set(settings.current().harnesses),
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

export const daemon: Context["daemon"] = {
	dataDir,
	lease: {
		host: lease.host,
		pid: lease.pid,
		epoch: lease.epoch,
		since: lease.since.getTime(),
	},
};
