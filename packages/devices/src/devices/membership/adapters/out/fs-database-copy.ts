import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "@nightshift/db";
import { iso } from "@nightshift/time";
import { sql } from "drizzle-orm";
import type { DatabaseCopy } from "../../application/ports";

/**
 * A copy of the whole database in the data directory, made in one
 * statement (`VACUUM INTO`).
 */
export function fsDatabaseCopy(db: Database): DatabaseCopy {
	return {
		async copy(dataDir, at, before = "personal-merge") {
			const folder = join(dataDir, "backups");
			await mkdir(folder, { recursive: true });
			const stamp = iso(at).replace(/[:.]/g, "-");
			const path = join(folder, `before-${before}-${stamp}.db`);
			await db.run(sql.raw(`VACUUM INTO '${path.replaceAll("'", "''")}'`));
			const copy = await stat(path).catch(() => null);
			if (!copy || copy.size === 0) {
				throw new Error(`The copy of the database at ${path} was not made.`);
			}
			return path;
		},
	};
}
