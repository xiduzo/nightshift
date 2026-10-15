import { homedir } from "node:os";
import { join } from "node:path";

import { claudeCodeHarness } from "@nightshift/agents";
import { createAuth } from "@nightshift/auth";
import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { createEngine } from "@nightshift/engine";

import { desktopOrigins, ENV } from "./env.server";

export const db = createDb(ENV);
await migrateDb(db);

export const auth = createAuth(ENV, db, desktopOrigins);

export const engine = await createEngine({
	db,
	harnesses: { "claude-code": claudeCodeHarness() },
	dataDir: ENV.NIGHTSHIFT_DATA_DIR ?? join(homedir(), ".nightshift"),
});
