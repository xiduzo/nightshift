import { defineConfig } from "drizzle-kit";
import "varlock/auto-load";

import { databaseUrl, ensureDataDir, resolveDataDir } from "./src/data-dir";

// The same database the daemon opens: DATABASE_URL, else nightshift.db in the
// data directory. The db:* scripts set NIGHTSHIFT_DEV, like `bun run dev`.
const dataDir = resolveDataDir({
	NIGHTSHIFT_DATA_DIR: process.env.NIGHTSHIFT_DATA_DIR,
	NIGHTSHIFT_DEV: process.env.NIGHTSHIFT_DEV === "true",
});

export default defineConfig({
	schema: "./src/schema/index.ts",
	out: "./src/migrate/migrations",
	dialect: "turso",
	dbCredentials: {
		url: databaseUrl(
			{ DATABASE_URL: process.env.DATABASE_URL },
			ensureDataDir(dataDir),
		),
	},
});
