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
	createConnectionStore,
	createEngine,
	createSettingsStore,
	keychainSecrets,
} from "@nightshift/engine";

import { desktopOrigins, ENV } from "./env.server";

export const db = createDb(ENV);
await migrateDb(db);

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

export const daemon: Context["daemon"] = { dataDir };
