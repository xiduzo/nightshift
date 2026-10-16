import { homedir } from "node:os";
import { join } from "node:path";

import {
	claudeCodeDecider,
	claudeCodeHarness,
	readGithubItems,
} from "@nightshift/agents";
import { createAuth } from "@nightshift/auth";
import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { createEngine } from "@nightshift/engine";

import { desktopOrigins, ENV } from "./env.server";

export const db = createDb(ENV);
await migrateDb(db);

export const auth = createAuth(ENV, db, desktopOrigins);

// `bun --hot` evaluates this module again on each reload. Only the newest
// engine may start scheduled runs: the one before stops its scheduler.
const hot = globalThis as { nightshiftScheduler?: AbortController };
hot.nightshiftScheduler?.abort();
const scheduler = new AbortController();
hot.nightshiftScheduler = scheduler;

export const engine = await createEngine({
	db,
	harnesses: { "claude-code": claudeCodeHarness() },
	decider: claudeCodeDecider(),
	readGithubItems: (input) => readGithubItems(input),
	dataDir: ENV.NIGHTSHIFT_DATA_DIR ?? join(homedir(), ".nightshift"),
	scheduler: { signal: scheduler.signal },
});
