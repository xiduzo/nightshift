import { defineConfig } from "drizzle-kit";

import * as schema from "./src/schema";

// The admin app migrates on start (`migrateInsights`). These scripts match
// `packages/db` as closely as Postgres allows. `db:generate` writes SQL
// from `src/schema` into `src/migrate/migrations`. It does not need a
// running database. `db:migrate` applies that SQL to `DATABASE_URL`.
void schema;

const url =
	process.env.DATABASE_URL ?? "postgres://localhost:5432/nightshift_insights";

export default defineConfig({
	schema: "./src/schema/index.ts",
	out: "./src/migrate/migrations",
	dialect: "postgresql",
	dbCredentials: { url },
});
