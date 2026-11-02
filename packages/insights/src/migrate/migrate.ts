import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import type { InsightsDb } from "../client";

/** The SQL migrations `db:generate` writes from the schema. */
export const migrationsFolder = fileURLToPath(
	new URL("./migrations", import.meta.url),
);

/** Applies every pending migration. The admin app calls this on start. */
export async function migrateInsights(db: InsightsDb): Promise<void> {
	await migrate(db, { migrationsFolder });
}
