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

export const auth = createAuth(ENV, createDb({ DATABASE_URL: ":memory:" }));
