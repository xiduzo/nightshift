import { homedir } from "node:os";
import { join } from "node:path";

import {
	type AgentHarness,
	checkGithub,
	checkHarness,
	claudeCodeDecider,
	claudeCodeHarness,
	codexHarness,
	opencodeHarness,
	readGithubItems,
	testMcpServer,
} from "@nightshift/agents";
import type { Context } from "@nightshift/api/context";
import { createAuth } from "@nightshift/auth";
import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import {
	acquireLease,
	createConnectionStore,
	createEngine,
	createSettingsStore,
	keychainSecrets,
	LEASE_HEARTBEAT_MS,
	type Lease,
	LeaseHeldError,
} from "@nightshift/engine";

import { desktopOrigins, ENV } from "./env.server";

export const db = createDb(ENV);
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
await Promise.all([settings.load(), connections.load()]);

/** A harness built per session, so a changed path in Settings applies to the next session. */
function perSession(
	name: AgentHarness["name"],
	build: () => AgentHarness,
): AgentHarness {
	return { name, run: (input) => build().run(input) };
}

const github = () => ({ gh: settings.current().ghBin });

// `bun --hot` evaluates this module again on each reload. Only the newest
// engine may start scheduled runs: the one before stops its scheduler.
const hot = globalThis as { nightshiftScheduler?: AbortController };
hot.nightshiftScheduler?.abort();
const scheduler = new AbortController();
hot.nightshiftScheduler = scheduler;

const dataDir = ENV.NIGHTSHIFT_DATA_DIR ?? join(homedir(), ".nightshift");

export const engine = await createEngine({
	db,
	harnesses: {
		// Each harness spawns its CLI only when an Agent node names it.
		"claude-code": perSession("claude-code", () =>
			claudeCodeHarness({
				claudeExecutable: settings.current().claudeBin,
				github: github(),
			}),
		),
		opencode: perSession("opencode", () =>
			opencodeHarness({
				opencodeExecutable: settings.current().opencodeBin,
				github: github(),
			}),
		),
		codex: perSession("codex", () =>
			codexHarness({
				codexExecutable: settings.current().codexBin,
				github: github(),
			}),
		),
	},
	decider: {
		name: "claude-code",
		decide: (input) =>
			claudeCodeDecider({
				claudeExecutable: settings.current().claudeBin,
				github: github(),
			}).decide(input),
	},
	readGithubItems: (input) => readGithubItems(input, { gh: github().gh }),
	dataDir,
	settings: () => settings.run(),
	mcpServersFor: (node) => connections.mcpServersFor(node),
	connectionNames: () => connections.names(),
	// NIGHTSHIFT_SCHEDULER=off: no scheduler at all, whatever Settings says.
	// Otherwise the Settings switch is read on every tick.
	scheduler:
		ENV.NIGHTSHIFT_SCHEDULER === "off" ? false : { signal: scheduler.signal },
});

export const checks: Context["checks"] = {
	harness: checkHarness,
	github: checkGithub,
	mcp: (config, redact) => testMcpServer(config, { redact }),
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
