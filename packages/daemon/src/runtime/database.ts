import { createDb, type Database } from "@nightshift/db";

import { hot } from "./hot";

/**
 * The database client of this process for `url`. `bun --hot` calls
 * `createDaemon` again on each reload, in the same process: the client
 * the first daemon opened goes on, so a reload opens no second client and
 * leaves none behind. The lease and the Device and Space documents, kept
 * across reloads, write through it too.
 */
export function processDatabase(url: string): Database {
	hot.nightshiftDatabases ??= new Map();
	const kept = hot.nightshiftDatabases.get(url);
	if (kept) return kept;
	const db = createDb({ DATABASE_URL: url });
	hot.nightshiftDatabases.set(url, db);
	return db;
}
