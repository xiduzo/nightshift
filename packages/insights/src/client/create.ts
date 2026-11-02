import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/** The Postgres handle the admin app passes to ingest and to the queries. */
export function createInsights(databaseUrl: string) {
	const client = postgres(databaseUrl, { max: 10 });
	return drizzle({ client });
}

export type InsightsDb = ReturnType<typeof createInsights>;
