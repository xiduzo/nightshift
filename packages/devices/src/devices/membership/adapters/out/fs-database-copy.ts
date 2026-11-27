import { join } from "node:path";
import { copyDatabase, type Database } from "@nightshift/db";
import type { DatabaseCopy } from "../../application/ports";

/** A copy of the whole database in `backups/` of the data directory (`copyDatabase`). */
export function fsDatabaseCopy(db: Database): DatabaseCopy {
	return {
		copy: (dataDir, at, before = "personal-merge") =>
			copyDatabase(db, join(dataDir, "backups"), before, at),
	};
}
