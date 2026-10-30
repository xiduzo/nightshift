/**
 * Better Auth as the daemon configures it, for `bun run auth:generate`
 * only: the Better Auth CLI reads `auth` here and writes the auth tables
 * (`packages/db/src/schema/auth.ts`). Loading it starts nothing: no lease,
 * no engine, no listener. The database is in memory, because the CLI reads
 * only the schema of the adapter.
 */
import "varlock/auto-load";

import { createAuth } from "@nightshift/auth";
import { createDb } from "@nightshift/db";

import { ENV } from "./env";

export const auth = createAuth(
	{
		BETTER_AUTH_URL: ENV.BETTER_AUTH_URL,
		CORS_ORIGIN: ENV.CORS_ORIGIN,
		// The CLI signs nothing: a dev checkout without a secret still generates.
		BETTER_AUTH_SECRET:
			ENV.BETTER_AUTH_SECRET ?? "schema-generation-only-signs-nothing",
	},
	createDb({ DATABASE_URL: ":memory:" }),
);
